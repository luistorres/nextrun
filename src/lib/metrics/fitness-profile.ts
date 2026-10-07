/**
 * Fitness profile calculator for onboarding.
 *
 * Lightweight, fast (<1s) function that computes a profile from DB data
 * for pre-filling onboarding form fields and showing a fitness summary.
 *
 * Intentionally separate from the heavy `buildAthleteAnalysis()` which
 * runs 7 parallel queries + Redis + response patterns for AI prompts.
 */

import type { Database } from "@/lib/db";
import { activities, dailySummaries } from "@/lib/db/schema";
import { eq, and, gte, desc } from "drizzle-orm";
import {
  estimateVDOTFromEasyPace,
  filterEasyRuns,
  predictRaceTime,
} from "@/lib/plan-engine/pace-calculator";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExperienceLevel = "beginner" | "intermediate" | "advanced";
export type DayOfWeek = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export interface PredictedRaceTimes {
  fiveK: number;
  tenK: number;
  halfMarathon: number;
  marathon: number;
  /**
   * How the predictions were derived. These are estimates extrapolated from
   * observed easy-run pace, not race results — consumers should frame them
   * as approximate.
   */
  basis: "easy_pace_estimate";
}

export interface CrossTrainingBreakdown {
  activityType: string;
  count: number;
  totalDurationMinutes: number;
}

export interface FitnessProfile {
  inferredTrainingDaysPerWeek: number;
  inferredPreferredDays: DayOfWeek[];
  inferredLongRunDay: DayOfWeek;
  recentWeeklyMileageKm: number;
  inferredExperienceLevel: ExperienceLevel;
  estimatedVDOT: number;
  garminVO2Max: number | null;
  restingHRAvg: number | null;
  avgEasyPaceSecsPerKm: number;
  predictedRaceTimes: PredictedRaceTimes;
  /** How many running activities were analyzed */
  activityCount: number;
  /** Date range span in days */
  dataSpanDays: number;
  /** Median unique training days/week across ALL activity types */
  totalTrainingDaysPerWeek: number;
  /** Per-type breakdown of non-run activities, sorted by count desc */
  crossTrainingActivities: CrossTrainingBreakdown[];
  /** Total non-run sessions in the lookback window */
  crossTrainingCount: number;
  /** Average aerobic training effect across ALL activities (0-5 scale) */
  avgAerobicTrainingEffect: number | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_ACTIVITIES = 7;
const ACTIVITY_LOOKBACK_DAYS = 90;
const SUMMARY_LOOKBACK_DAYS = 28;

const DAY_NAMES: DayOfWeek[] = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Compute a fitness profile from the user's Garmin data.
 * Returns null if insufficient data (<7 activities in 90 days).
 *
 * Running-specific metrics (VDOT, pace, mileage, predicted times) use only
 * run activities. Cross-training metrics (total frequency, activity breakdown,
 * aerobic training effect) use all activity types.
 */
export async function computeFitnessProfile(
  db: Database,
  userId: string,
): Promise<FitnessProfile | null> {
  const now = new Date();
  const activityCutoff = new Date(now);
  activityCutoff.setDate(activityCutoff.getDate() - ACTIVITY_LOOKBACK_DAYS);

  const summaryCutoff = new Date(now);
  summaryCutoff.setDate(summaryCutoff.getDate() - SUMMARY_LOOKBACK_DAYS);

  // Run queries in parallel
  const [runActivities, allActivities, recentSummaries] = await Promise.all([
    db
      .select({
        startTime: activities.startTime,
        distanceMeters: activities.distanceMeters,
        avgPaceSecondsPerKm: activities.avgPaceSecondsPerKm,
        avgHeartRate: activities.avgHeartRate,
      })
      .from(activities)
      .where(
        and(
          eq(activities.userId, userId),
          eq(activities.activityType, "run"),
          gte(activities.startTime, activityCutoff),
        ),
      )
      .orderBy(desc(activities.startTime)),
    db
      .select({
        activityType: activities.activityType,
        startTime: activities.startTime,
        durationSeconds: activities.durationSeconds,
        trainingEffectAerobic: activities.trainingEffectAerobic,
      })
      .from(activities)
      .where(
        and(
          eq(activities.userId, userId),
          gte(activities.startTime, activityCutoff),
        ),
      )
      .orderBy(desc(activities.startTime)),
    db
      .select({
        vo2Max: dailySummaries.vo2Max,
        restingHeartRate: dailySummaries.restingHeartRate,
      })
      .from(dailySummaries)
      .where(
        and(
          eq(dailySummaries.userId, userId),
          gte(
            dailySummaries.calendarDate,
            summaryCutoff.toISOString().split("T")[0],
          ),
        ),
      )
      .orderBy(desc(dailySummaries.calendarDate)),
  ]);

  // Gate: need minimum data from either runs or total activities
  if (runActivities.length < MIN_ACTIVITIES && allActivities.length < MIN_ACTIVITIES) {
    return null;
  }

  // --- Infer training days per week and preferred days ---
  const weekMap = new Map<string, Set<number>>(); // ISO week → set of day-of-week
  const dayFrequency = new Map<number, number>(); // day-of-week → count

  for (const act of runActivities) {
    const d = new Date(act.startTime);
    const dow = d.getDay(); // 0=Sun
    const isoWeek = getISOWeek(d);

    dayFrequency.set(dow, (dayFrequency.get(dow) ?? 0) + 1);

    if (!weekMap.has(isoWeek)) weekMap.set(isoWeek, new Set());
    weekMap.get(isoWeek)!.add(dow);
  }

  // Median runs per week
  const runsPerWeek = Array.from(weekMap.values())
    .map((s) => s.size)
    .sort((a, b) => a - b);
  const inferredTrainingDaysPerWeek = median(runsPerWeek);

  // Preferred days: sorted by frequency, take top N
  const sortedDays = Array.from(dayFrequency.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([dow]) => DAY_NAMES[dow]);
  const inferredPreferredDays = sortedDays.slice(
    0,
    inferredTrainingDaysPerWeek,
  );

  // --- Infer long run day ---
  const weekLongestDay = new Map<string, { dow: number; dist: number }>();
  for (const act of runActivities) {
    const d = new Date(act.startTime);
    const isoWeek = getISOWeek(d);
    const dist = Number(act.distanceMeters) || 0;
    const current = weekLongestDay.get(isoWeek);
    if (!current || dist > current.dist) {
      weekLongestDay.set(isoWeek, { dow: d.getDay(), dist });
    }
  }
  const longRunDayFreq = new Map<number, number>();
  for (const { dow } of weekLongestDay.values()) {
    longRunDayFreq.set(dow, (longRunDayFreq.get(dow) ?? 0) + 1);
  }
  const inferredLongRunDay =
    DAY_NAMES[
      Array.from(longRunDayFreq.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0
    ];

  // --- Recent weekly mileage (last 4 full weeks) ---
  const fourWeeksAgo = new Date(now);
  fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
  const recentRuns = runActivities.filter(
    (a) => new Date(a.startTime) >= fourWeeksAgo,
  );
  const totalDistKm =
    recentRuns.reduce((sum, a) => sum + (Number(a.distanceMeters) || 0), 0) /
    1000;
  const recentWeeklyMileageKm = Math.round((totalDistKm / 4) * 10) / 10;

  // --- Easy pace + VDOT ---
  // Candidate runs: distance >= 2km, plausible pace between 180-540 s/km
  const pacedRunSamples = runActivities
    .filter((a) => {
      const dist = Number(a.distanceMeters) || 0;
      const pace = Number(a.avgPaceSecondsPerKm) || 0;
      return dist >= 2000 && pace >= 180 && pace <= 540;
    })
    .map((a) => ({
      avgPaceSecsPerKm: Number(a.avgPaceSecondsPerKm),
      avgHR: a.avgHeartRate ?? undefined,
    }));

  // Anchor to genuinely easy efforts (HR-gated when available) so tempo and
  // interval sessions don't inflate the VDOT estimate. Fall back to all
  // paced runs if nothing qualifies as easy.
  const hrFilteredEasyRuns = filterEasyRuns(pacedRunSamples);
  const easyRuns =
    hrFilteredEasyRuns.length > 0 ? hrFilteredEasyRuns : pacedRunSamples;

  const easyPaces = easyRuns
    .map((r) => r.avgPaceSecsPerKm)
    .sort((a, b) => a - b);

  const avgEasyPaceSecsPerKm =
    easyPaces.length > 0 ? median(easyPaces) : 360; // fallback 6:00/km

  const estimatedVDOT = estimateVDOTFromEasyPace(avgEasyPaceSecsPerKm);

  // --- Garmin VO2Max + resting HR ---
  const vo2Values = recentSummaries
    .map((s) => (s.vo2Max != null ? Number(s.vo2Max) : null))
    .filter((v): v is number => v != null && v > 0);
  const garminVO2Max = vo2Values.length > 0 ? vo2Values[0] : null; // most recent

  const rhrValues = recentSummaries
    .map((s) => s.restingHeartRate)
    .filter((v): v is number => v != null && v > 0);
  const restingHRAvg =
    rhrValues.length > 0
      ? Math.round(rhrValues.reduce((a, b) => a + b, 0) / rhrValues.length)
      : null;

  // --- Cross-training metrics ---
  const crossTrainingMap = new Map<string, { count: number; durationSeconds: number }>();
  for (const act of allActivities) {
    if (act.activityType === "run") continue;
    const existing = crossTrainingMap.get(act.activityType) ?? { count: 0, durationSeconds: 0 };
    existing.count += 1;
    existing.durationSeconds += Number(act.durationSeconds) || 0;
    crossTrainingMap.set(act.activityType, existing);
  }

  const crossTrainingActivities: CrossTrainingBreakdown[] = Array.from(
    crossTrainingMap.entries(),
  )
    .map(([activityType, { count, durationSeconds }]) => ({
      activityType,
      count,
      totalDurationMinutes: Math.round(durationSeconds / 60),
    }))
    .sort((a, b) => b.count - a.count);

  const crossTrainingCount = crossTrainingActivities.reduce(
    (sum, ct) => sum + ct.count,
    0,
  );

  // Total training days/week (all activity types)
  const allWeekMap = new Map<string, Set<number>>();
  for (const act of allActivities) {
    const d = new Date(act.startTime);
    const dow = d.getDay();
    const isoWeek = getISOWeek(d);
    if (!allWeekMap.has(isoWeek)) allWeekMap.set(isoWeek, new Set());
    allWeekMap.get(isoWeek)!.add(dow);
  }
  const allDaysPerWeek = Array.from(allWeekMap.values())
    .map((s) => s.size)
    .sort((a, b) => a - b);
  const totalTrainingDaysPerWeek = median(allDaysPerWeek);

  // Average aerobic training effect across ALL activities
  const allAerobicTE = allActivities
    .map((a) =>
      a.trainingEffectAerobic != null ? Number(a.trainingEffectAerobic) : null,
    )
    .filter((v): v is number => v != null && v > 0);
  const avgAerobicTrainingEffect =
    allAerobicTE.length > 0
      ? Math.round(
          (allAerobicTE.reduce((a, b) => a + b, 0) / allAerobicTE.length) * 10,
        ) / 10
      : null;

  // --- Experience level ---
  const runsIn90d = runActivities.length;
  const avgRunsPerWeek =
    runsPerWeek.length > 0
      ? runsPerWeek.reduce((a, b) => a + b, 0) / runsPerWeek.length
      : 0;
  const vo2ForLevel = garminVO2Max ?? estimatedVDOT; // best available

  const isActiveMultiSportAthlete =
    totalTrainingDaysPerWeek >= 4 &&
    avgAerobicTrainingEffect != null &&
    avgAerobicTrainingEffect >= 2.5;

  let inferredExperienceLevel: ExperienceLevel;
  if (
    recentWeeklyMileageKm >= 50 &&
    avgRunsPerWeek >= 3 &&
    vo2ForLevel >= 50
  ) {
    inferredExperienceLevel = "advanced";
  } else if (recentWeeklyMileageKm < 15 || runsIn90d < 12) {
    // Low running volume — but check cross-training signal
    inferredExperienceLevel = isActiveMultiSportAthlete
      ? "intermediate"
      : "beginner";
  } else {
    inferredExperienceLevel = "intermediate";
  }

  // --- Predicted race times ---
  const predictedRaceTimes: PredictedRaceTimes = {
    fiveK: predictRaceTime(estimatedVDOT, 5000),
    tenK: predictRaceTime(estimatedVDOT, 10000),
    halfMarathon: predictRaceTime(estimatedVDOT, 21097),
    marathon: predictRaceTime(estimatedVDOT, 42195),
    basis: "easy_pace_estimate",
  };

  // --- Data span (across all activities for full picture) ---
  const allOldest = allActivities[allActivities.length - 1];
  const allNewest = allActivities[0];
  const dataSpanDays = allOldest
    ? Math.ceil(
        (new Date(allNewest.startTime).getTime() -
          new Date(allOldest.startTime).getTime()) /
          (1000 * 60 * 60 * 24),
      )
    : 0;

  return {
    inferredTrainingDaysPerWeek,
    inferredPreferredDays,
    inferredLongRunDay,
    recentWeeklyMileageKm,
    inferredExperienceLevel,
    estimatedVDOT,
    garminVO2Max,
    restingHRAvg,
    avgEasyPaceSecsPerKm,
    predictedRaceTimes,
    activityCount: runActivities.length,
    dataSpanDays,
    totalTrainingDaysPerWeek,
    crossTrainingActivities,
    crossTrainingCount,
    avgAerobicTrainingEffect,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Get ISO week string like "2025-W03" for grouping */
function getISOWeek(d: Date): string {
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const dayOfYear =
    Math.floor(
      (d.getTime() - new Date(d.getFullYear(), 0, 1).getTime()) /
        (86400 * 1000),
    ) + 1;
  const weekNum = Math.ceil((dayOfYear + jan4.getDay() - 1) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}
