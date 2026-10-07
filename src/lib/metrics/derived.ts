/**
 * Science-backed derived metrics computed from raw Garmin health/activity data.
 *
 * These metrics are calculated deterministically before being sent to the AI,
 * replacing raw data dumps with pre-interpreted athlete analysis.
 *
 * References:
 * - ACWR: Banister impulse-response model (Hulin et al., 2014)
 * - TRIMP: Training Impulse (Banister, 1991)
 * - Recovery composite: adapted from Plews et al. (2013), HRV-guided training
 * - Sleep architecture: Walker (2017), Halson (2014)
 */

import type { Database } from "@/lib/db";
import { eq, and, between, asc } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { subDays, format } from "date-fns";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ACWRRiskBand = "undertrained" | "optimal" | "caution" | "high_risk";

export interface ACWRResult {
  /** Acute (7-day) training load (TRIMP) */
  acuteLoad: number;
  /** Chronic (28-day) training load (TRIMP) */
  chronicLoad: number;
  /** Acute:Chronic ratio */
  ratio: number | null;
  /** Risk classification */
  riskBand: ACWRRiskBand;
  /** Number of sessions in the acute window */
  acuteSessions: number;
  /** Number of sessions in the chronic window */
  chronicSessions: number;
}

export type RecoveryStatus =
  | "ready"
  | "moderate"
  | "fatigued"
  | "depleted"
  | "unknown";

/**
 * Single source of truth for recovery score classification.
 * UI copy and prompt text must use these bands — do not restate thresholds.
 */
export const RECOVERY_THRESHOLDS = {
  READY: 70,
  MODERATE: 50,
  FATIGUED: 30,
} as const;

export type RecoveryConfidence = "full" | "partial" | "none";

export interface RecoveryReadinessResult {
  /** Overall score 0-100, or null when no component had data */
  score: number | null;
  status: RecoveryStatus;
  /**
   * How much signal backs the score: "full" = all 4 components present,
   * "partial" = 1-3 present (score is rescaled from available components),
   * "none" = no data — score is null and status is "unknown".
   */
  confidence: RecoveryConfidence;
  /** Component breakdown (0-25 each) */
  components: {
    hrv: number;
    sleep: number;
    bodyBattery: number;
    stress: number;
  };
  /** Which components had insufficient data */
  missingData: string[];
}

export type SleepArchitecture = "optimal" | "suboptimal" | "poor";

export interface SleepQualityResult {
  /** Overall index 0-100 */
  index: number;
  architecture: SleepArchitecture;
  /** Sleep stage percentages */
  composition: {
    deepPercent: number;
    remPercent: number;
    lightPercent: number;
    awakePercent: number;
  };
  /** Duration adequacy vs 7-9h recommendation */
  durationAdequacy: "short" | "adequate" | "long";
  durationHours: number;
  /** 7-day average score (null if insufficient data) */
  weeklyTrend: number | null;
}

export interface PaceEfficiencyResult {
  /** Current pace:HR ratio (lower = more efficient) */
  currentRatio: number | null;
  /** 28-day average pace:HR ratio */
  baselineRatio: number | null;
  /** Change from baseline (negative = improving) */
  changePercent: number | null;
  /** Pace consistency: coefficient of variation across recent runs */
  paceCV: number | null;
  /** Number of runs analyzed */
  runCount: number;
}

export type WeeklyLoadSpikeRiskBand = "safe" | "caution" | "spike";

export interface WeeklyLoadSpikeResult {
  /** Total TRIMP for the current 7-day rolling window */
  currentWeekLoad: number;
  /** Total TRIMP for the prior 7-day rolling window */
  previousWeekLoad: number;
  /** Current / previous ratio (null when previous = 0) */
  spikeRatio: number | null;
  /** Percentage change from prior week (negative = reduction, null when previous = 0) */
  spikePercent: number | null;
  /**
   * Risk band per Blanch & Gabbett (2015):
   * - safe: < 20% increase
   * - caution: 20–49% increase
   * - spike: ≥ 50% increase (sharp single-week ramp, independent of ACWR)
   */
  riskBand: WeeklyLoadSpikeRiskBand;
  /** Sessions logged in the current 7-day window */
  sessionsCurrentWeek: number;
  /** Sessions logged in the prior 7-day window */
  sessionsPreviousWeek: number;
}

export interface CadenceTrendResult {
  /** Average run cadence (steps/min, both feet) over the last 7 days */
  current7dAvg: number | null;
  /** 28-day baseline average cadence */
  baseline28dAvg: number | null;
  /** Change of 7d vs 28d baseline (%) — negative = cadence dropping */
  changePercent: number | null;
  /** Runs with cadence data in the 28-day window */
  runCount: number;
}

export type RPETrendDirection = "stable" | "rising" | "falling";

export interface RPEFatigueSummary {
  /** 7-day average RPE (Borg CR-10 scale, 1–10) */
  sevenDayAvgRpe: number | null;
  /** 28-day baseline average RPE */
  baselineAvgRpe: number | null;
  /** Trend direction: rising = more perceived effort than baseline */
  trend: RPETrendDirection;
  /** Foster (1998) session load = sum(RPE × duration_minutes) over 7 days */
  fosterSessionLoad: number;
  /** Sessions with RPE data in the past 7 days */
  dataPoints: number;
}

// ---------------------------------------------------------------------------
// 1. ACWR — Acute:Chronic Workload Ratio
// ---------------------------------------------------------------------------

/**
 * Calculate the Acute:Chronic Workload Ratio using TRIMP-based EWMA.
 *
 * TRIMP (Training Impulse) = duration_minutes × fractional_HR_intensity
 * where intensity uses Banister's exponential weighting:
 *   male: duration × ΔHR_ratio × 0.64 × e^(1.92 × ΔHR_ratio)
 *
 * EWMA (Exponentially Weighted Moving Average) gives more weight to recent
 * sessions, which is more sensitive than simple rolling averages.
 */
export async function calculateACWR(
  db: Database,
  userId: string,
  asOf: Date = new Date(),
): Promise<ACWRResult> {
  const chronicDays = 28;
  const acuteDays = 7;
  const fromDate = subDays(asOf, chronicDays);

  // Fetch activities and resting HR for TRIMP calculation
  const [activityRows, dailySummaryRows] = await Promise.all([
    db
      .select({
        startTime: schema.activities.startTime,
        durationSeconds: schema.activities.durationSeconds,
        avgHeartRate: schema.activities.avgHeartRate,
        maxHeartRate: schema.activities.maxHeartRate,
        rpeScore: schema.activities.rpeScore,
      })
      .from(schema.activities)
      .where(
        and(
          eq(schema.activities.userId, userId),
          between(schema.activities.startTime, fromDate, asOf),
        ),
      )
      .orderBy(asc(schema.activities.startTime)),
    db
      .select({
        calendarDate: schema.dailySummaries.calendarDate,
        restingHeartRate: schema.dailySummaries.restingHeartRate,
      })
      .from(schema.dailySummaries)
      .where(
        and(
          eq(schema.dailySummaries.userId, userId),
          between(
            schema.dailySummaries.calendarDate,
            format(fromDate, "yyyy-MM-dd"),
            format(asOf, "yyyy-MM-dd"),
          ),
        ),
      ),
  ]);

  // Build a map of date → restingHR for TRIMP calculation
  const restingHRByDate = new Map<string, number>();
  for (const row of dailySummaryRows) {
    if (row.restingHeartRate != null) {
      restingHRByDate.set(row.calendarDate, row.restingHeartRate);
    }
  }

  // Fallback resting HR: average of available values, or 60 bpm
  const restingHRValues = [...restingHRByDate.values()];
  const fallbackRestingHR =
    restingHRValues.length > 0
      ? Math.round(
          restingHRValues.reduce((a, b) => a + b, 0) / restingHRValues.length,
        )
      : 60;

  // Aggregate TRIMP per calendar day. The EWMA must be iterated once per day
  // (including zero-load rest days) — iterating per activity makes the decay
  // rate depend on session frequency: rest days would never decay the load and
  // two-a-days would decay it twice (Williams et al., 2017).
  const acuteCutoff = subDays(asOf, acuteDays);
  let acuteSessions = 0;
  let chronicSessions = 0;

  const dailyTrimp = new Map<string, number>();
  for (const activity of activityRows) {
    const day = format(activity.startTime, "yyyy-MM-dd");
    const trimp = calculateTRIMP(
      activity.durationSeconds,
      activity.avgHeartRate,
      activity.maxHeartRate,
      restingHRByDate.get(day) ?? fallbackRestingHR,
      activity.rpeScore,
    );
    dailyTrimp.set(day, (dailyTrimp.get(day) ?? 0) + trimp);

    chronicSessions++;
    if (activity.startTime >= acuteCutoff) {
      acuteSessions++;
    }
  }

  // EWMA decay constants (lambda)
  const acuteLambda = 2 / (acuteDays + 1);
  const chronicLambda = 2 / (chronicDays + 1);

  let acuteEWMA = 0;
  let chronicEWMA = 0;

  for (let dayOffset = chronicDays; dayOffset >= 0; dayOffset--) {
    const day = format(subDays(asOf, dayOffset), "yyyy-MM-dd");
    const load = dailyTrimp.get(day) ?? 0;
    acuteEWMA = load * acuteLambda + acuteEWMA * (1 - acuteLambda);
    chronicEWMA = load * chronicLambda + chronicEWMA * (1 - chronicLambda);
  }

  const acuteLoad = round2(acuteEWMA);
  const chronicLoad = round2(chronicEWMA);

  // Ratio and risk classification
  const ratio =
    chronicLoad > 0 ? round2(acuteLoad / chronicLoad) : null;

  return {
    acuteLoad,
    chronicLoad,
    ratio,
    riskBand: classifyACWRRisk(ratio),
    acuteSessions,
    chronicSessions,
  };
}

/**
 * Calculate TRIMP (Training Impulse) for a single session.
 * Uses Banister's exponential heart rate scaling formula.
 *
 * Fallback chain when HR is missing (treadmill, strap failure, optical off):
 * 1. Athlete RPE (Borg CR-10) mapped to a fractional HR-reserve estimate,
 *    then run through the same Banister formula — keeps a single load scale.
 * 2. No RPE either: assume an easy-moderate session (~0.55 HRR). The old
 *    `duration × 0.5` fallback scored a 60-min run ~30 vs ~80–120 with HR,
 *    fabricating detraining for every no-HR athlete.
 */
export function calculateTRIMP(
  durationSeconds: number,
  avgHeartRate: number | null,
  maxHeartRate: number | null,
  restingHeartRate: number,
  rpeScore?: number | null,
): number {
  const minutes = durationSeconds / 60;

  if (avgHeartRate == null) {
    // Borg CR-10 → %HRR mapping (RPE 3 ≈ 60%, 6 ≈ 75%, 9 ≈ 90%)
    const estimatedHRR =
      rpeScore != null
        ? Math.min(0.95, Math.max(0.3, 0.45 + rpeScore * 0.05))
        : 0.55;
    return minutes * estimatedHRR * 0.64 * Math.exp(1.92 * estimatedHRR);
  }

  // Use max HR if available, otherwise estimate: 220 - age (fallback 190)
  const maxHR = maxHeartRate ?? 190;

  // Fractional heart rate reserve (Karvonen)
  const deltaHRRatio = Math.max(
    0,
    Math.min(1, (avgHeartRate - restingHeartRate) / (maxHR - restingHeartRate)),
  );

  // Banister TRIMP formula (gender-neutral approximation)
  // TRIMP = duration × ΔHR × 0.64 × e^(1.92 × ΔHR)
  return minutes * deltaHRRatio * 0.64 * Math.exp(1.92 * deltaHRRatio);
}

function classifyACWRRisk(ratio: number | null): ACWRRiskBand {
  if (ratio == null) return "undertrained";
  if (ratio < 0.8) return "undertrained";
  if (ratio <= 1.3) return "optimal";
  if (ratio <= 1.5) return "caution";
  return "high_risk";
}

// ---------------------------------------------------------------------------
// 2. Recovery Readiness Score
// ---------------------------------------------------------------------------

/**
 * Calculate a composite recovery readiness score (0-100).
 *
 * Four components, 25 points each:
 * 1. HRV vs baseline (hrvLastNight compared to 28-day avg)
 * 2. Sleep quality (sleepScore + deep sleep proportion)
 * 3. Body battery (morning start value)
 * 4. Inverse stress (lower avg stress + lower high-stress duration = better)
 */
export async function calculateRecoveryReadiness(
  db: Database,
  userId: string,
  asOf: Date = new Date(),
): Promise<RecoveryReadinessResult> {
  const today = format(asOf, "yyyy-MM-dd");
  const baselineStart = format(subDays(asOf, 28), "yyyy-MM-dd");

  // Fetch today's data + 28-day baseline in parallel
  const [
    todayHRV,
    baselineHRV,
    todaySleep,
    todayDaily,
    _baselineDaily, // eslint-disable-line @typescript-eslint/no-unused-vars
    todayStress,
  ] = await Promise.all([
    db
      .select()
      .from(schema.hrvRecords)
      .where(
        and(
          eq(schema.hrvRecords.userId, userId),
          eq(schema.hrvRecords.calendarDate, today),
        ),
      )
      .limit(1),
    db
      .select({ hrvLastNight: schema.hrvRecords.hrvLastNight })
      .from(schema.hrvRecords)
      .where(
        and(
          eq(schema.hrvRecords.userId, userId),
          between(schema.hrvRecords.calendarDate, baselineStart, today),
        ),
      ),
    db
      .select()
      .from(schema.sleepRecords)
      .where(
        and(
          eq(schema.sleepRecords.userId, userId),
          eq(schema.sleepRecords.calendarDate, today),
        ),
      )
      .limit(1),
    db
      .select()
      .from(schema.dailySummaries)
      .where(
        and(
          eq(schema.dailySummaries.userId, userId),
          eq(schema.dailySummaries.calendarDate, today),
        ),
      )
      .limit(1),
    db
      .select({ bodyBatteryStart: schema.dailySummaries.bodyBatteryStart })
      .from(schema.dailySummaries)
      .where(
        and(
          eq(schema.dailySummaries.userId, userId),
          between(schema.dailySummaries.calendarDate, baselineStart, today),
        ),
      ),
    db
      .select()
      .from(schema.stressRecords)
      .where(
        and(
          eq(schema.stressRecords.userId, userId),
          eq(schema.stressRecords.calendarDate, today),
        ),
      )
      .limit(1),
  ]);

  const missingData: string[] = [];

  // --- Component 1: HRV (0-25) ---
  // Scored against the athlete's individual smallest worthwhile change
  // (SWC ≈ 0.5 × day-to-day CV), the method validated by HRV-guided
  // training studies (Kiviniemi 2007, Javaloyes 2019). Values inside the
  // normal-variation band — or above it — are full credit; only drops
  // beyond the athlete's own noise floor are penalized.
  let hrvScore = 0;
  const todayHRVValue = todayHRV[0]?.hrvLastNight
    ? parseFloat(String(todayHRV[0].hrvLastNight))
    : null;
  const baselineHRVValues = baselineHRV
    .map((r) => (r.hrvLastNight ? parseFloat(String(r.hrvLastNight)) : null))
    .filter(nonNull);
  const hrvBaseline = safeAverage(baselineHRVValues);

  if (todayHRVValue != null && hrvBaseline != null && hrvBaseline > 0) {
    if (baselineHRVValues.length >= 7) {
      const variance =
        baselineHRVValues.reduce(
          (sum, v) => sum + (v - hrvBaseline) ** 2,
          0,
        ) / baselineHRVValues.length;
      const cv = Math.sqrt(variance) / hrvBaseline;
      const swc = Math.max(0.02, 0.5 * cv) * hrvBaseline; // ms

      const lowerBound = hrvBaseline - swc;
      if (todayHRVValue >= lowerBound) {
        // Within the athlete's normal variation, or above baseline
        hrvScore = 25;
      } else {
        // Below the SWC band — scale down toward a floor at 60% of baseline
        const floor = hrvBaseline * 0.6;
        const t = (todayHRVValue - floor) / Math.max(1e-6, lowerBound - floor);
        hrvScore = Math.round(Math.max(0, Math.min(1, t)) * 25);
      }
    } else {
      // Too few readings to estimate individual variation — simple ratio
      const ratio = todayHRVValue / hrvBaseline;
      hrvScore = Math.round(Math.min(25, Math.max(0, ratio * 25)));
    }
  } else {
    missingData.push("hrv");
  }

  // --- Component 2: Sleep (0-25) ---
  let sleepScore = 0;
  const sleep = todaySleep[0];
  if (sleep?.sleepScore != null) {
    // Garmin sleep score is 0-100; map to 0-15 points
    const garminScore = Math.min(15, Math.round((sleep.sleepScore / 100) * 15));

    // Deep sleep bonus: 13-23% is healthy range → 0-10 points
    let deepBonus = 0;
    if (
      sleep.deepSleepSeconds != null &&
      sleep.totalSleepSeconds != null &&
      sleep.totalSleepSeconds > 0
    ) {
      const deepPct = sleep.deepSleepSeconds / sleep.totalSleepSeconds;
      if (deepPct >= 0.13 && deepPct <= 0.23) {
        // In healthy range — scale within range
        deepBonus = 10;
      } else if (deepPct >= 0.08) {
        deepBonus = Math.round(((deepPct - 0.08) / 0.05) * 10);
      }
    }

    sleepScore = Math.min(25, garminScore + deepBonus);
  } else {
    missingData.push("sleep");
  }

  // --- Component 3: Body Battery (0-25) ---
  let bodyBatteryScore = 0;
  const bbToday = todayDaily[0]?.bodyBatteryStart;
  if (bbToday != null) {
    // Body battery is 0-100; map directly to 0-25
    bodyBatteryScore = Math.round((bbToday / 100) * 25);
  } else {
    missingData.push("bodyBattery");
  }

  // --- Component 4: Inverse Stress (0-25) ---
  let stressScore = 0;
  const stress = todayStress[0];
  if (stress?.avgStress != null) {
    // Lower stress = higher score. avgStress typically 0-100.
    // Base: invert avg stress → 0-15 points
    const baseStress = Math.round(((100 - stress.avgStress) / 100) * 15);

    // High stress duration penalty: 0-10 points
    let durationBonus = 10;
    if (stress.highStressDurationSeconds != null) {
      // More than 4h of high stress = 0 bonus
      const highStressHours = stress.highStressDurationSeconds / 3600;
      durationBonus = Math.round(
        Math.max(0, 10 - (highStressHours / 4) * 10),
      );
    }

    stressScore = Math.min(25, baseStress + durationBonus);
  } else {
    missingData.push("stress");
  }

  // If data is missing, redistribute available component weights.
  // With zero components we report "unknown" — never a fabricated number.
  const availableComponents = 4 - missingData.length;

  if (availableComponents === 0) {
    return {
      score: null,
      status: "unknown",
      confidence: "none",
      components: { hrv: 0, sleep: 0, bodyBattery: 0, stress: 0 },
      missingData,
    };
  }

  const rawScore = hrvScore + sleepScore + bodyBatteryScore + stressScore;
  // Scale up proportionally for missing components
  let totalScore = Math.round((rawScore / availableComponents) * 4);
  totalScore = Math.min(100, Math.max(0, totalScore));

  return {
    score: totalScore,
    status: classifyRecoveryStatus(totalScore),
    confidence: availableComponents === 4 ? "full" : "partial",
    components: {
      hrv: hrvScore,
      sleep: sleepScore,
      bodyBattery: bodyBatteryScore,
      stress: stressScore,
    },
    missingData,
  };
}

export function classifyRecoveryStatus(score: number): RecoveryStatus {
  if (score >= RECOVERY_THRESHOLDS.READY) return "ready";
  if (score >= RECOVERY_THRESHOLDS.MODERATE) return "moderate";
  if (score >= RECOVERY_THRESHOLDS.FATIGUED) return "fatigued";
  return "depleted";
}

// ---------------------------------------------------------------------------
// 3. Sleep Quality Index
// ---------------------------------------------------------------------------

/**
 * Calculate a detailed sleep quality index from sleep composition data.
 *
 * Uses sleep architecture analysis based on:
 * - Deep sleep: healthy range 13-23% (Ohayon et al., 2004)
 * - REM sleep: healthy range 20-25% (Carskadon & Dement, 2011)
 * - Duration: 7-9 hours recommended for adults (Hirshkowitz et al., 2015)
 */
export async function calculateSleepQuality(
  db: Database,
  userId: string,
  asOf: Date = new Date(),
): Promise<SleepQualityResult | null> {
  const today = format(asOf, "yyyy-MM-dd");
  const weekAgo = format(subDays(asOf, 7), "yyyy-MM-dd");

  const [todaySleep, weekSleep] = await Promise.all([
    db
      .select()
      .from(schema.sleepRecords)
      .where(
        and(
          eq(schema.sleepRecords.userId, userId),
          eq(schema.sleepRecords.calendarDate, today),
        ),
      )
      .limit(1),
    db
      .select({ sleepScore: schema.sleepRecords.sleepScore })
      .from(schema.sleepRecords)
      .where(
        and(
          eq(schema.sleepRecords.userId, userId),
          between(schema.sleepRecords.calendarDate, weekAgo, today),
        ),
      ),
  ]);

  const sleep = todaySleep[0];
  if (!sleep || sleep.totalSleepSeconds == null) return null;

  const totalSeconds = sleep.totalSleepSeconds;
  const durationHours = round2(totalSeconds / 3600);

  // Calculate composition percentages
  const deep = sleep.deepSleepSeconds ?? 0;
  const rem = sleep.remSleepSeconds ?? 0;
  const light = sleep.lightSleepSeconds ?? 0;
  const awake = sleep.awakeSeconds ?? 0;
  const measuredTotal = deep + rem + light + awake || totalSeconds;

  const composition = {
    deepPercent: round2((deep / measuredTotal) * 100),
    remPercent: round2((rem / measuredTotal) * 100),
    lightPercent: round2((light / measuredTotal) * 100),
    awakePercent: round2((awake / measuredTotal) * 100),
  };

  // Score: start with Garmin sleep score, then adjust for architecture
  let index = sleep.sleepScore ?? 50;

  // Architecture adjustments
  const deepPct = composition.deepPercent;
  const remPct = composition.remPercent;

  // Deep sleep: penalize if outside 13-23%
  if (deepPct < 10) index -= 15;
  else if (deepPct < 13) index -= 5;
  else if (deepPct > 30) index -= 5;

  // REM: penalize if below 15%
  if (remPct < 10) index -= 10;
  else if (remPct < 15) index -= 5;

  // Duration penalty
  if (durationHours < 6) index -= 15;
  else if (durationHours < 7) index -= 5;
  else if (durationHours > 10) index -= 5;

  index = Math.min(100, Math.max(0, index));

  // Architecture classification
  const architecture = classifySleepArchitecture(
    composition.deepPercent,
    composition.remPercent,
    durationHours,
  );

  // Duration adequacy
  const durationAdequacy: SleepQualityResult["durationAdequacy"] =
    durationHours < 7 ? "short" : durationHours > 9 ? "long" : "adequate";

  // Weekly trend
  const weekScores = weekSleep
    .map((s) => s.sleepScore)
    .filter(nonNull);
  const weeklyTrend = safeAverage(weekScores);

  return {
    index,
    architecture,
    composition,
    durationAdequacy,
    durationHours,
    weeklyTrend,
  };
}

function classifySleepArchitecture(
  deepPct: number,
  remPct: number,
  durationHours: number,
): SleepArchitecture {
  const deepGood = deepPct >= 13 && deepPct <= 23;
  const remGood = remPct >= 20 && remPct <= 25;
  const durationGood = durationHours >= 7 && durationHours <= 9;

  if (deepGood && remGood && durationGood) return "optimal";
  if ((deepGood || remGood) && durationGood) return "suboptimal";
  if (deepPct >= 10 && remPct >= 15 && durationHours >= 6) return "suboptimal";
  return "poor";
}

// ---------------------------------------------------------------------------
// 4. Pace Efficiency
// ---------------------------------------------------------------------------

/**
 * Calculate pace efficiency metrics from recent running activities.
 *
 * Pace:HR ratio = avgPaceSecondsPerKm / avgHeartRate
 * Lower ratio = more efficient (faster pace at same HR, or same pace at lower HR).
 *
 * Elevation-adjusted: normalize pace by adding ~5 sec/km per 10m elevation/km.
 */
export async function calculatePaceEfficiency(
  db: Database,
  userId: string,
  asOf: Date = new Date(),
): Promise<PaceEfficiencyResult> {
  const recentStart = subDays(asOf, 14);
  const baselineStart = subDays(asOf, 42); // 6 weeks for baseline

  const [recentRuns, baselineRuns] = await Promise.all([
    db
      .select({
        avgPaceSecondsPerKm: schema.activities.avgPaceSecondsPerKm,
        avgHeartRate: schema.activities.avgHeartRate,
        elevationGainMeters: schema.activities.elevationGainMeters,
        distanceMeters: schema.activities.distanceMeters,
      })
      .from(schema.activities)
      .where(
        and(
          eq(schema.activities.userId, userId),
          eq(schema.activities.activityType, "running"),
          between(schema.activities.startTime, recentStart, asOf),
        ),
      )
      .orderBy(asc(schema.activities.startTime)),
    db
      .select({
        avgPaceSecondsPerKm: schema.activities.avgPaceSecondsPerKm,
        avgHeartRate: schema.activities.avgHeartRate,
        elevationGainMeters: schema.activities.elevationGainMeters,
        distanceMeters: schema.activities.distanceMeters,
      })
      .from(schema.activities)
      .where(
        and(
          eq(schema.activities.userId, userId),
          eq(schema.activities.activityType, "running"),
          between(schema.activities.startTime, baselineStart, recentStart),
        ),
      ),
  ]);

  const recentRatios = computePaceHRRatios(recentRuns);
  const baselineRatios = computePaceHRRatios(baselineRuns);

  const currentRatio = safeAverage(recentRatios);
  const baselineRatio = safeAverage(baselineRatios);

  const changePercent =
    currentRatio != null && baselineRatio != null && baselineRatio > 0
      ? round2(((currentRatio - baselineRatio) / baselineRatio) * 100)
      : null;

  // Pace consistency: CV of pace across recent runs
  const recentPaces = recentRuns
    .map((r) =>
      r.avgPaceSecondsPerKm
        ? parseFloat(String(r.avgPaceSecondsPerKm))
        : null,
    )
    .filter(nonNull);
  const paceCV = calculateCV(recentPaces);

  return {
    currentRatio,
    baselineRatio,
    changePercent,
    paceCV,
    runCount: recentRuns.length,
  };
}

function computePaceHRRatios(
  runs: {
    avgPaceSecondsPerKm: string | null;
    avgHeartRate: number | null;
    elevationGainMeters: string | null;
    distanceMeters: string | null;
  }[],
): number[] {
  const ratios: number[] = [];

  for (const run of runs) {
    if (run.avgPaceSecondsPerKm == null || run.avgHeartRate == null) continue;
    if (run.avgHeartRate < 80) continue; // filter out bad data

    let pace = parseFloat(String(run.avgPaceSecondsPerKm));

    // Elevation-adjust: subtract ~5 sec/km per 10m elevation gain per km
    if (run.elevationGainMeters != null && run.distanceMeters != null) {
      const elevGain = parseFloat(String(run.elevationGainMeters));
      const distKm = parseFloat(String(run.distanceMeters)) / 1000;
      if (distKm > 0) {
        const elevPerKm = elevGain / distKm;
        pace -= (elevPerKm / 10) * 5;
      }
    }

    ratios.push(round2(pace / run.avgHeartRate));
  }

  return ratios;
}

function calculateCV(values: number[]): number | null {
  if (values.length < 3) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return null;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return round2((Math.sqrt(variance) / mean) * 100);
}

// ---------------------------------------------------------------------------
// 5. Weekly Load Spike Detection
// ---------------------------------------------------------------------------

/**
 * Detect week-to-week load spikes as an independent load-ramp signal.
 *
 * Based on Blanch & Gabbett (2015): a rapid week-to-week increase in training
 * load (≥50%) is associated with elevated soft-tissue injury risk regardless
 * of the chronic ACWR. A well-conditioned athlete with ACWR 1.1 can still be
 * at risk if the current week's load spiked 60% from the prior week.
 *
 * Uses two rolling 7-day windows:
 * - Current window: last 7 days
 * - Previous window: days 8–14
 *
 * Load is quantified via TRIMP (same formula as ACWR) for consistency.
 */
export async function calculateWeeklyLoadSpike(
  db: Database,
  userId: string,
  asOf: Date = new Date(),
): Promise<WeeklyLoadSpikeResult> {
  const currentWeekStart = subDays(asOf, 7);
  const previousWeekStart = subDays(asOf, 14);

  const [activityRows, dailySummaryRows] = await Promise.all([
    db
      .select({
        startTime: schema.activities.startTime,
        durationSeconds: schema.activities.durationSeconds,
        avgHeartRate: schema.activities.avgHeartRate,
        maxHeartRate: schema.activities.maxHeartRate,
        rpeScore: schema.activities.rpeScore,
      })
      .from(schema.activities)
      .where(
        and(
          eq(schema.activities.userId, userId),
          between(schema.activities.startTime, previousWeekStart, asOf),
        ),
      )
      .orderBy(asc(schema.activities.startTime)),
    db
      .select({
        calendarDate: schema.dailySummaries.calendarDate,
        restingHeartRate: schema.dailySummaries.restingHeartRate,
      })
      .from(schema.dailySummaries)
      .where(
        and(
          eq(schema.dailySummaries.userId, userId),
          between(
            schema.dailySummaries.calendarDate,
            format(previousWeekStart, "yyyy-MM-dd"),
            format(asOf, "yyyy-MM-dd"),
          ),
        ),
      ),
  ]);

  // Resting HR map for TRIMP (same pattern as calculateACWR)
  const restingHRByDate = new Map<string, number>();
  for (const row of dailySummaryRows) {
    if (row.restingHeartRate != null) {
      restingHRByDate.set(row.calendarDate, row.restingHeartRate);
    }
  }
  const restingHRValues = [...restingHRByDate.values()];
  const fallbackRestingHR =
    restingHRValues.length > 0
      ? Math.round(restingHRValues.reduce((a, b) => a + b, 0) / restingHRValues.length)
      : 60;

  // Partition activities into current and previous week, sum TRIMP
  let currentWeekLoad = 0;
  let previousWeekLoad = 0;
  let sessionsCurrentWeek = 0;
  let sessionsPreviousWeek = 0;

  for (const activity of activityRows) {
    const trimp = calculateTRIMP(
      activity.durationSeconds,
      activity.avgHeartRate,
      activity.maxHeartRate,
      restingHRByDate.get(format(activity.startTime, "yyyy-MM-dd")) ?? fallbackRestingHR,
      activity.rpeScore,
    );

    if (activity.startTime >= currentWeekStart) {
      currentWeekLoad += trimp;
      sessionsCurrentWeek++;
    } else {
      previousWeekLoad += trimp;
      sessionsPreviousWeek++;
    }
  }

  currentWeekLoad = round2(currentWeekLoad);
  previousWeekLoad = round2(previousWeekLoad);

  const spikeRatio =
    previousWeekLoad > 0 ? round2(currentWeekLoad / previousWeekLoad) : null;
  const spikePercent =
    previousWeekLoad > 0
      ? round2(((currentWeekLoad - previousWeekLoad) / previousWeekLoad) * 100)
      : null;

  let riskBand: WeeklyLoadSpikeRiskBand = "safe";
  if (spikePercent != null) {
    if (spikePercent >= 50) riskBand = "spike";
    else if (spikePercent >= 20) riskBand = "caution";
  }

  return {
    currentWeekLoad,
    previousWeekLoad,
    spikeRatio,
    spikePercent,
    riskBand,
    sessionsCurrentWeek,
    sessionsPreviousWeek,
  };
}

// ---------------------------------------------------------------------------
// 6. RPE Fatigue — Foster (1998) session RPE method
// ---------------------------------------------------------------------------

/**
 * Calculate perceived-effort fatigue from athlete RPE scores.
 *
 * Foster et al. (1998) Session RPE: session_load = RPE × duration_minutes
 * This composite captures neuromuscular fatigue, heat/humidity, mental fatigue,
 * and early illness onset — signals invisible to HR-based TRIMP.
 *
 * Data source: planned_workouts where athlete recorded rpeScore at completion.
 */
export async function calculateRPEFatigue(
  db: Database,
  userId: string,
  asOf: Date = new Date(),
): Promise<RPEFatigueSummary> {
  const sevenDaysAgo = subDays(asOf, 7);
  const twentyEightDaysAgo = subDays(asOf, 28);
  const sevenDaysAgoStr = format(sevenDaysAgo, "yyyy-MM-dd");
  const twentyEightDaysAgoStr = format(twentyEightDaysAgo, "yyyy-MM-dd");
  const todayStr = format(asOf, "yyyy-MM-dd");

  // Fetch completed workouts with RPE data over the past 28 days
  // Join through training_plans to filter by userId (planned_workouts has no direct userId)
  const rpeWorkouts = await db
    .select({
      scheduledDate: schema.plannedWorkouts.scheduledDate,
      rpeScore: schema.plannedWorkouts.rpeScore,
      targetDurationSeconds: schema.plannedWorkouts.targetDurationSeconds,
    })
    .from(schema.plannedWorkouts)
    .innerJoin(schema.trainingPlans, eq(schema.plannedWorkouts.planId, schema.trainingPlans.id))
    .where(
      and(
        eq(schema.trainingPlans.userId, userId),
        eq(schema.plannedWorkouts.completionStatus, "completed"),
        between(schema.plannedWorkouts.scheduledDate, twentyEightDaysAgoStr, todayStr),
      ),
    )
    .orderBy(asc(schema.plannedWorkouts.scheduledDate));

  // Only rows with athlete-recorded RPE
  const withRpe = rpeWorkouts.filter((w) => w.rpeScore != null);

  // Partition into 7-day (acute) and 28-day (baseline) windows
  const recent = withRpe.filter((w) => w.scheduledDate >= sevenDaysAgoStr);

  const sevenDayRpes = recent.map((w) => w.rpeScore!);
  const baselineRpes = withRpe.map((w) => w.rpeScore!);

  const sevenDayAvgRpe = safeAverage(sevenDayRpes);
  const baselineAvgRpe = safeAverage(baselineRpes);

  // Foster session load: sum(RPE × duration_minutes) for 7-day window
  const fosterSessionLoad = recent.reduce((sum, w) => {
    const durationMin = w.targetDurationSeconds ? w.targetDurationSeconds / 60 : 0;
    return sum + (w.rpeScore! * durationMin);
  }, 0);

  // Trend: rising when 7d avg exceeds 28d baseline by >0.5 points
  let trend: RPETrendDirection = "stable";
  if (sevenDayAvgRpe != null && baselineAvgRpe != null) {
    const diff = sevenDayAvgRpe - baselineAvgRpe;
    if (diff > 0.5) trend = "rising";
    else if (diff < -0.5) trend = "falling";
  }

  return {
    sevenDayAvgRpe,
    baselineAvgRpe,
    trend,
    fosterSessionLoad: round2(fosterSessionLoad),
    dataPoints: sevenDayRpes.length,
  };
}

// ---------------------------------------------------------------------------
// 7. Cadence Trend — best-evidenced actionable running-dynamics metric
// ---------------------------------------------------------------------------

/**
 * Track average run cadence (7d vs 28d baseline) from activity summaries.
 *
 * Low cadence correlates with overstriding and higher impact loading;
 * a modest (~5%) cadence increase reduces loading at the knee/tibia
 * without hurting economy. A dropping cadence late in a block can also
 * indicate accumulating fatigue. Cadence is treated as an actionable
 * coaching signal — vertical oscillation/ratio are deliberately NOT used
 * (weaker evidence, device-limited).
 */
export async function calculateCadenceTrend(
  db: Database,
  userId: string,
  asOf: Date = new Date(),
): Promise<CadenceTrendResult> {
  const sevenDaysAgo = subDays(asOf, 7);
  const twentyEightDaysAgo = subDays(asOf, 28);

  const rows = await db
    .select({
      startTime: schema.activities.startTime,
      activityType: schema.activities.activityType,
      avgRunCadence: schema.activities.avgRunCadence,
    })
    .from(schema.activities)
    .where(
      and(
        eq(schema.activities.userId, userId),
        between(schema.activities.startTime, twentyEightDaysAgo, asOf),
      ),
    )
    .orderBy(asc(schema.activities.startTime));

  const runs = rows.filter(
    (r) =>
      (r.activityType === "run" || r.activityType === "running") &&
      r.avgRunCadence != null,
  );

  const allCadences = runs.map((r) => parseFloat(String(r.avgRunCadence)));
  const recentCadences = runs
    .filter((r) => r.startTime >= sevenDaysAgo)
    .map((r) => parseFloat(String(r.avgRunCadence)));

  const baseline28dAvg = safeAverage(allCadences);
  const current7dAvg = safeAverage(recentCadences);

  const changePercent =
    baseline28dAvg != null && baseline28dAvg > 0 && current7dAvg != null
      ? round2(((current7dAvg - baseline28dAvg) / baseline28dAvg) * 100)
      : null;

  return {
    current7dAvg,
    baseline28dAvg,
    changePercent,
    runCount: runs.length,
  };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function nonNull<T>(value: T | null | undefined): value is T {
  return value != null;
}

function safeAverage(values: number[]): number | null {
  if (values.length === 0) return null;
  return round2(values.reduce((a, b) => a + b, 0) / values.length);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
