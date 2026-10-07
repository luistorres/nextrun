/**
 * Individual response pattern calculator.
 *
 * Computes athlete-specific training response patterns from accumulated
 * health and activity data. Patterns require a minimum of 6 data points
 * before they are considered reliable.
 *
 * Calculated weekly and stored in the `athlete_response_patterns` table.
 */

import type { Database } from "@/lib/db";
import { eq, and, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { subDays, format, addDays } from "date-fns";
import type { ResponseType } from "@/lib/db/schema/training";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const MIN_DATA_POINTS = 6;

export interface ResponseProfile {
  /** Hours for HRV to return to baseline after intervals */
  hrvRecoveryAfterIntervals: number | null;
  /** Hours for HRV to return to baseline after long runs */
  hrvRecoveryAfterLongRuns: number | null;
  /** Whether athlete responds better to volume or intensity */
  responseType: ResponseType;
  /** Best days for hard sessions (highest avg recovery readiness) */
  optimalHardDays: string[];
  /** Pace:HR decoupling rate (% HR drift per 30 min) */
  paceHrDecouplingRate: number | null;
  /** Data points per pattern for confidence assessment */
  dataPoints: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Calculate all individual response patterns for an athlete.
 *
 * Uses data from the last 90 days. Each pattern requires at least
 * MIN_DATA_POINTS observations to be considered reliable.
 */
export async function calculateResponsePatterns(
  db: Database,
  userId: string,
  asOf: Date = new Date(),
): Promise<ResponseProfile> {
  const ninetyDaysAgo = subDays(asOf, 90);

  // Load activities and HRV data in parallel
  const [activities, hrvRecords, dailySummaries] = await Promise.all([
    db
      .select()
      .from(schema.activities)
      .where(
        and(
          eq(schema.activities.userId, userId),
          sql`${schema.activities.startTime} >= ${ninetyDaysAgo}`,
        ),
      )
      .orderBy(schema.activities.startTime),
    db
      .select()
      .from(schema.hrvRecords)
      .where(
        and(
          eq(schema.hrvRecords.userId, userId),
          sql`${schema.hrvRecords.calendarDate} >= ${format(ninetyDaysAgo, "yyyy-MM-dd")}`,
        ),
      )
      .orderBy(schema.hrvRecords.calendarDate),
    db
      .select()
      .from(schema.dailySummaries)
      .where(
        and(
          eq(schema.dailySummaries.userId, userId),
          sql`${schema.dailySummaries.calendarDate} >= ${format(ninetyDaysAgo, "yyyy-MM-dd")}`,
        ),
      )
      .orderBy(schema.dailySummaries.calendarDate),
  ]);

  const dataPoints: Record<string, number> = {};

  // Calculate each pattern
  const hrvRecoveryAfterIntervals = calculateHRVRecovery(
    activities,
    hrvRecords,
    ["intervals", "hill_repeats"],
    dataPoints,
    "hrvRecoveryAfterIntervals",
  );

  const hrvRecoveryAfterLongRuns = calculateHRVRecovery(
    activities,
    hrvRecords,
    ["long_run"],
    dataPoints,
    "hrvRecoveryAfterLongRuns",
  );

  const responseType = calculateResponseType(activities, dailySummaries, dataPoints);

  const optimalHardDays = calculateOptimalDays(dailySummaries, dataPoints);

  const paceHrDecouplingRate = calculateDecouplingRate(activities, dataPoints);

  return {
    hrvRecoveryAfterIntervals,
    hrvRecoveryAfterLongRuns,
    responseType,
    optimalHardDays,
    paceHrDecouplingRate,
    dataPoints,
  };
}

/**
 * Recalculate and store response patterns for a user.
 * Called weekly by the adaptation worker.
 */
export async function updateResponsePatterns(
  db: Database,
  userId: string,
): Promise<void> {
  const profile = await calculateResponsePatterns(db, userId);

  // Upsert: delete old record, insert new one
  await db
    .delete(schema.athleteResponsePatterns)
    .where(eq(schema.athleteResponsePatterns.userId, userId));

  await db.insert(schema.athleteResponsePatterns).values({
    userId,
    hrvRecoveryAfterIntervals: profile.hrvRecoveryAfterIntervals?.toString() ?? null,
    hrvRecoveryAfterLongRuns: profile.hrvRecoveryAfterLongRuns?.toString() ?? null,
    responseType: profile.responseType,
    optimalHardDays: profile.optimalHardDays,
    paceHrDecouplingRate: profile.paceHrDecouplingRate?.toString() ?? null,
    dataPoints: profile.dataPoints,
    computedAt: new Date(),
    updatedAt: new Date(),
  });
}

/**
 * Load the stored response profile for a user.
 * Returns null if no patterns have been computed yet.
 */
export async function getStoredResponseProfile(
  db: Database,
  userId: string,
): Promise<ResponseProfile | null> {
  const record = await db.query.athleteResponsePatterns.findFirst({
    where: eq(schema.athleteResponsePatterns.userId, userId),
  });

  if (!record) return null;

  return {
    hrvRecoveryAfterIntervals: record.hrvRecoveryAfterIntervals
      ? parseFloat(record.hrvRecoveryAfterIntervals)
      : null,
    hrvRecoveryAfterLongRuns: record.hrvRecoveryAfterLongRuns
      ? parseFloat(record.hrvRecoveryAfterLongRuns)
      : null,
    responseType: record.responseType ?? "unknown",
    optimalHardDays: record.optimalHardDays ?? [],
    paceHrDecouplingRate: record.paceHrDecouplingRate
      ? parseFloat(record.paceHrDecouplingRate)
      : null,
    dataPoints: record.dataPoints ?? {},
  };
}

// ---------------------------------------------------------------------------
// Pattern calculators
// ---------------------------------------------------------------------------

type ActivityRow = typeof schema.activities.$inferSelect;
type HRVRow = typeof schema.hrvRecords.$inferSelect;
type DailySummaryRow = typeof schema.dailySummaries.$inferSelect;

/**
 * Calculate average HRV recovery time after specific workout types.
 *
 * Method: For each hard session, track HRV for 1-4 days after.
 * Measure hours until HRV returns within 5% of 7-day baseline before the session.
 */
function calculateHRVRecovery(
  activities: ActivityRow[],
  hrvRecords: HRVRow[],
  workoutTypes: string[],
  dataPoints: Record<string, number>,
  key: string,
): number | null {
  // Find matching hard sessions
  const hardSessions = activities.filter(
    (a) =>
      workoutTypes.some((t) => a.activityType.includes(t)) ||
      (a.plannedWorkoutId && a.wasPlanned),
  );

  // Build an HRV lookup by date
  const hrvByDate = new Map<string, number>();
  for (const h of hrvRecords) {
    const val = parseFloat(String(h.hrvLastNight ?? h.hrvWeeklyAvg ?? "0"));
    if (val > 0) {
      hrvByDate.set(h.calendarDate, val);
    }
  }

  const recoveryHours: number[] = [];

  for (const session of hardSessions) {
    const sessionDate = new Date(session.startTime);

    // Calculate 7-day HRV baseline before this session
    const baselineValues: number[] = [];
    for (let d = 1; d <= 7; d++) {
      const prevDate = format(subDays(sessionDate, d), "yyyy-MM-dd");
      const val = hrvByDate.get(prevDate);
      if (val) baselineValues.push(val);
    }

    if (baselineValues.length < 3) continue; // Need at least 3 days of baseline

    const baselineAvg =
      baselineValues.reduce((s, v) => s + v, 0) / baselineValues.length;
    const threshold = baselineAvg * 0.95; // Within 5% of baseline

    // Track HRV for 1-4 days after the session
    for (let d = 1; d <= 4; d++) {
      const checkDate = format(addDays(sessionDate, d), "yyyy-MM-dd");
      const hrvVal = hrvByDate.get(checkDate);

      if (hrvVal && hrvVal >= threshold) {
        recoveryHours.push(d * 24); // Approximate to days * 24h
        break;
      }

      // If we checked 4 days and still not recovered
      if (d === 4 && hrvVal) {
        recoveryHours.push(96); // Cap at 96h
      }
    }
  }

  dataPoints[key] = recoveryHours.length;

  if (recoveryHours.length < MIN_DATA_POINTS) return null;

  return (
    recoveryHours.reduce((s, v) => s + v, 0) / recoveryHours.length
  );
}

/**
 * Determine if athlete responds better to volume or intensity changes.
 *
 * Method: Correlate VO2max changes with volume vs intensity over 8-week windows.
 * If VO2max improves more during high-volume low-intensity periods → volume responder.
 * If VO2max improves more during lower-volume higher-intensity periods → intensity responder.
 */
function calculateResponseType(
  activities: ActivityRow[],
  dailySummaries: DailySummaryRow[],
  dataPoints: Record<string, number>,
): ResponseType {
  // Need VO2max data points across time
  const vo2Readings = dailySummaries
    .filter((d) => d.vo2Max != null)
    .map((d) => ({
      date: d.calendarDate,
      vo2: parseFloat(String(d.vo2Max)),
    }))
    .filter((v) => v.vo2 > 0);

  dataPoints["responseType"] = vo2Readings.length;

  if (vo2Readings.length < MIN_DATA_POINTS) return "unknown";

  // Split activities into 4-week windows and classify each
  const runActivities = activities.filter(
    (a) => a.activityType === "run" || a.activityType === "running",
  );

  if (runActivities.length < 12) return "unknown";

  // Calculate intensity ratio for each 4-week window
  const windows: { volumeKm: number; hardRatio: number; vo2Change: number }[] = [];

  for (let i = 0; i < vo2Readings.length - 1; i++) {
    const startDate = vo2Readings[i].date;
    const endDate = vo2Readings[Math.min(i + 1, vo2Readings.length - 1)].date;
    const vo2Change = vo2Readings[Math.min(i + 1, vo2Readings.length - 1)].vo2 - vo2Readings[i].vo2;

    // Activities in this window
    const windowActivities = runActivities.filter((a) => {
      const d = format(new Date(a.startTime), "yyyy-MM-dd");
      return d >= startDate && d <= endDate;
    });

    if (windowActivities.length < 3) continue;

    const totalKm = windowActivities.reduce(
      (s, a) => s + (a.distanceMeters ? parseFloat(String(a.distanceMeters)) / 1000 : 0),
      0,
    );

    const hardCount = windowActivities.filter(
      (a) => {
        const te = a.trainingEffectAerobic ? parseFloat(String(a.trainingEffectAerobic)) : 0;
        return te >= 3.0;
      },
    ).length;

    windows.push({
      volumeKm: totalKm,
      hardRatio: hardCount / windowActivities.length,
      vo2Change,
    });
  }

  if (windows.length < 3) return "unknown";

  // Correlate: positive vo2Change with high volume vs high intensity
  const medianVolume = median(windows.map((w) => w.volumeKm));
  const medianIntensity = median(windows.map((w) => w.hardRatio));

  let volumeScore = 0;
  let intensityScore = 0;

  for (const w of windows) {
    if (w.vo2Change > 0) {
      if (w.volumeKm > medianVolume) volumeScore++;
      if (w.hardRatio > medianIntensity) intensityScore++;
    }
  }

  if (volumeScore > intensityScore * 1.5) return "volume_responder";
  if (intensityScore > volumeScore * 1.5) return "intensity_responder";
  return "balanced";
}

/**
 * Find the best days of week for hard sessions.
 *
 * Method: Average body battery start (proxy for readiness) by day-of-week.
 * Return days where avg body battery is above the overall mean.
 */
function calculateOptimalDays(
  dailySummaries: DailySummaryRow[],
  dataPoints: Record<string, number>,
): string[] {
  const dayNames = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];

  const byDay = new Map<string, number[]>();
  for (const d of dayNames) {
    byDay.set(d, []);
  }

  for (const ds of dailySummaries) {
    if (ds.bodyBatteryStart == null) continue;
    const date = new Date(ds.calendarDate + "T12:00:00"); // Noon to avoid timezone issues
    const dayName = dayNames[date.getDay()];
    byDay.get(dayName)!.push(ds.bodyBatteryStart);
  }

  const totalPoints = dailySummaries.filter((d) => d.bodyBatteryStart != null).length;
  dataPoints["optimalHardDays"] = totalPoints;

  if (totalPoints < MIN_DATA_POINTS * 7) return []; // Need ~6 weeks of data

  // Calculate averages and find days above mean
  const dayAvgs: { day: string; avg: number }[] = [];
  let sum = 0;
  let count = 0;

  for (const [day, values] of byDay) {
    if (values.length < 3) continue; // Need at least 3 data points per day
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    dayAvgs.push({ day, avg });
    sum += avg;
    count++;
  }

  if (count === 0) return [];

  const overallMean = sum / count;

  // Return days above mean, sorted by readiness (best first)
  return dayAvgs
    .filter((d) => d.avg > overallMean)
    .sort((a, b) => b.avg - a.avg)
    .map((d) => d.day);
}

/**
 * Calculate pace:HR decoupling rate.
 *
 * Method: For easy runs > 30 min, compare pace:HR ratio in first half
 * vs second half. A higher decoupling rate indicates poorer aerobic fitness.
 * Returns % HR drift per 30 min on average.
 */
function calculateDecouplingRate(
  activities: ActivityRow[],
  dataPoints: Record<string, number>,
): number | null {
  // We need activities with both pace and HR data, duration > 30 min
  const eligibleRuns = activities.filter(
    (a) =>
      (a.activityType === "run" || a.activityType === "running") &&
      a.durationSeconds >= 1800 &&
      a.avgHeartRate != null &&
      a.avgPaceSecondsPerKm != null &&
      parseFloat(String(a.avgPaceSecondsPerKm)) > 0,
  );

  dataPoints["paceHrDecouplingRate"] = eligibleRuns.length;

  if (eligibleRuns.length < MIN_DATA_POINTS) return null;

  // Without split data (first/second half), we approximate using the
  // relationship between duration and pace:HR ratio across multiple runs.
  // Longer runs at similar effort show more cardiac drift.
  const ratios = eligibleRuns.map((a) => ({
    durationMin: a.durationSeconds / 60,
    paceHrRatio:
      parseFloat(String(a.avgPaceSecondsPerKm!)) / (a.avgHeartRate ?? 1),
  }));

  // Simple linear regression: paceHrRatio vs durationMin
  // The slope tells us drift per minute, we normalize to per 30 min
  const n = ratios.length;
  const sumX = ratios.reduce((s, r) => s + r.durationMin, 0);
  const sumY = ratios.reduce((s, r) => s + r.paceHrRatio, 0);
  const sumXY = ratios.reduce((s, r) => s + r.durationMin * r.paceHrRatio, 0);
  const sumXX = ratios.reduce((s, r) => s + r.durationMin * r.durationMin, 0);

  const denominator = n * sumXX - sumX * sumX;
  if (Math.abs(denominator) < 0.001) return null;

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const meanRatio = sumY / n;

  if (meanRatio === 0) return null;

  // Convert slope to % change per 30 minutes
  const driftPer30Min = (slope * 30 / meanRatio) * 100;

  return Math.round(driftPer30Min * 100) / 100;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}
