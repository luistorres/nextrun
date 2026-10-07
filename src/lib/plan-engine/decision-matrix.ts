/**
 * Adaptation decision matrix.
 *
 * Evaluates derived metrics (ACWR, recovery readiness, sleep quality)
 * and training compliance to determine if a plan adaptation is needed.
 *
 * Upgraded from raw health thresholds to science-backed derived metrics
 * computed in src/lib/metrics/derived.ts.
 */

import type { MetricsTrend, TrainingLoadSummary } from "@/types/metrics";
import type { AdaptationTrigger } from "@/types/plan";
import type { ACWRResult, RecoveryReadinessResult, SleepQualityResult, WeeklyLoadSpikeResult, RPEFatigueSummary } from "@/lib/metrics/derived";
import type { WorkoutExecutionSummary } from "@/lib/metrics/workout-execution";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DecisionResult {
  shouldAdapt: boolean;
  triggers: AdaptationTriggerDetail[];
  severity: "low" | "medium" | "high";
}

export interface AdaptationTriggerDetail {
  type: AdaptationTrigger;
  reason: string;
  severity: "low" | "medium" | "high";
  metric?: string;
  value?: number;
  threshold?: number;
}

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

const THRESHOLDS = {
  /** Recovery readiness below this → reduce intensity */
  RECOVERY_FATIGUED: 50,
  /** Recovery readiness below this → easy only */
  RECOVERY_DEPLETED: 30,
  /** ACWR above this → limit load increases */
  ACWR_CAUTION: 1.3,
  /** ACWR above this → block intensity increases */
  ACWR_HIGH_RISK: 1.5,
  /** Sleep quality index below this → flag */
  SLEEP_QUALITY_LOW: 50,
  /** Number of missed workouts in a week to trigger rescheduling */
  MISSED_WORKOUTS_THRESHOLD: 2,
  /** Compliance rate below this → reschedule */
  COMPLIANCE_LOW_PERCENT: 60,
  /** Stress increase percentage to flag */
  STRESS_INCREASE_PERCENT: 15,
  /** Execution ratio below which a key workout is under-executed */
  UNDER_EXECUTION_RATIO: 0.6,
  /** Weekly load % increase entering caution zone (Blanch & Gabbett, 2015) */
  WEEKLY_LOAD_SPIKE_CAUTION: 20,
  /** Weekly load % increase treated as a sharp single-week ramp regardless of ACWR */
  WEEKLY_LOAD_SPIKE_HIGH: 50,
  /** RPE average above this = critically high — likely neuromuscular overreach */
  RPE_CRITICAL: 9,
  /** RPE average above this = elevated — consider reducing intensity */
  RPE_ELEVATED: 8,
} as const;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Evaluate derived metrics and training data to determine if adaptation is needed.
 *
 * @param acwr - Acute:Chronic Workload Ratio
 * @param recovery - Recovery readiness composite score
 * @param sleepQuality - Detailed sleep quality (optional)
 * @param trends - 7d vs 28d metric trends
 * @param trainingLoad - Current week's training load summary
 * @param hasUnplannedActivity - Whether an unplanned high-intensity activity was detected
 */
export function evaluateDecisionMatrix(opts: {
  acwr: ACWRResult;
  recovery: RecoveryReadinessResult;
  sleepQuality?: SleepQualityResult | null;
  trends: MetricsTrend[];
  trainingLoad: TrainingLoadSummary;
  hasUnplannedActivity?: boolean;
  workoutExecution?: WorkoutExecutionSummary;
  weeklyLoadSpike?: WeeklyLoadSpikeResult | null;
  rpeFatigue?: RPEFatigueSummary | null;
}): DecisionResult {
  const { acwr, recovery, sleepQuality, trends, trainingLoad, hasUnplannedActivity, workoutExecution, weeklyLoadSpike, rpeFatigue } = opts;
  const triggers: AdaptationTriggerDetail[] = [];

  // ── ACWR — load-ramp monitor (descriptive heuristic, not injury prediction) ──
  if (acwr.ratio != null) {
    if (acwr.ratio > THRESHOLDS.ACWR_HIGH_RISK) {
      triggers.push({
        type: "poor_recovery",
        reason: `ACWR ${acwr.ratio.toFixed(2)} exceeds ${THRESHOLDS.ACWR_HIGH_RISK} — load ramping much faster than the chronic base. Block intensity increases.`,
        severity: "high",
        metric: "acwr",
        value: acwr.ratio,
        threshold: THRESHOLDS.ACWR_HIGH_RISK,
      });
    } else if (acwr.ratio > THRESHOLDS.ACWR_CAUTION) {
      triggers.push({
        type: "poor_recovery",
        reason: `ACWR ${acwr.ratio.toFixed(2)} in caution zone (>${THRESHOLDS.ACWR_CAUTION}). Limit load increases.`,
        severity: "medium",
        metric: "acwr",
        value: acwr.ratio,
        threshold: THRESHOLDS.ACWR_CAUTION,
      });
    }
  }

  // ── Recovery readiness (replaces separate HRV + body battery checks) ──
  // score is null when no component had data — no trigger from absence of data.
  if (recovery.score != null && recovery.score < THRESHOLDS.RECOVERY_DEPLETED) {
    triggers.push({
      type: "poor_recovery",
      reason: `Recovery readiness ${recovery.score}/100 — depleted (threshold: ${THRESHOLDS.RECOVERY_DEPLETED}). Easy training only.`,
      severity: "high",
      metric: "recoveryReadiness",
      value: recovery.score,
      threshold: THRESHOLDS.RECOVERY_DEPLETED,
    });
  } else if (recovery.score != null && recovery.score < THRESHOLDS.RECOVERY_FATIGUED) {
    triggers.push({
      type: "poor_recovery",
      reason: `Recovery readiness ${recovery.score}/100 — fatigued (threshold: ${THRESHOLDS.RECOVERY_FATIGUED}). Reduce intensity.`,
      severity: "medium",
      metric: "recoveryReadiness",
      value: recovery.score,
      threshold: THRESHOLDS.RECOVERY_FATIGUED,
    });
  }

  // ── Sleep quality (replaces raw sleep score decline check) ────────────
  if (sleepQuality) {
    if (sleepQuality.index < THRESHOLDS.SLEEP_QUALITY_LOW) {
      triggers.push({
        type: "poor_recovery",
        reason: `Sleep quality index ${sleepQuality.index}/100 — ${sleepQuality.architecture} architecture. Below threshold (${THRESHOLDS.SLEEP_QUALITY_LOW}).`,
        severity: "medium",
        metric: "sleepQuality",
        value: sleepQuality.index,
        threshold: THRESHOLDS.SLEEP_QUALITY_LOW,
      });
    }

    if (sleepQuality.durationAdequacy === "short" && sleepQuality.durationHours < 6) {
      triggers.push({
        type: "poor_recovery",
        reason: `Sleep duration critically short: ${sleepQuality.durationHours}h (< 6h). Recovery severely impacted.`,
        severity: "high",
        metric: "sleepDuration",
        value: sleepQuality.durationHours,
        threshold: 6,
      });
    }
  }

  // ── Missed workouts / compliance ─────────────────────────────────────
  if (trainingLoad.workoutsMissed >= THRESHOLDS.MISSED_WORKOUTS_THRESHOLD) {
    triggers.push({
      type: "missed_workout",
      reason: `Missed ${trainingLoad.workoutsMissed} workout(s) this week (threshold: ${THRESHOLDS.MISSED_WORKOUTS_THRESHOLD}). Plan may need rescheduling.`,
      severity: trainingLoad.workoutsMissed >= 3 ? "high" : "medium",
      metric: "missedWorkouts",
      value: trainingLoad.workoutsMissed,
      threshold: THRESHOLDS.MISSED_WORKOUTS_THRESHOLD,
    });
  }

  // Compliance rate
  if (
    trainingLoad.workoutsPlanned > 0 &&
    trainingLoad.workoutsCompleted / trainingLoad.workoutsPlanned <
      THRESHOLDS.COMPLIANCE_LOW_PERCENT / 100
  ) {
    const complianceRate = Math.round(
      (trainingLoad.workoutsCompleted / trainingLoad.workoutsPlanned) * 100,
    );
    triggers.push({
      type: "missed_workout",
      reason: `Compliance rate ${complianceRate}% (${trainingLoad.workoutsCompleted}/${trainingLoad.workoutsPlanned}) below ${THRESHOLDS.COMPLIANCE_LOW_PERCENT}%. Volume may need adjustment.`,
      severity: "medium",
      metric: "complianceRate",
      value: complianceRate,
      threshold: THRESHOLDS.COMPLIANCE_LOW_PERCENT,
    });
  }

  // ── Unplanned activity ───────────────────────────────────────────────
  if (hasUnplannedActivity) {
    triggers.push({
      type: "unplanned_activity",
      reason:
        "An unplanned high-intensity activity was detected. Upcoming workouts may need adjustment to account for extra load.",
      severity: "medium",
    });
  }

  // ── Workout execution quality — key sessions completed at <60% distance ──
  if (workoutExecution?.hasSignificantUnderExecution) {
    const ratio = workoutExecution.avgDistanceRatioKeyWorkouts ?? 0;
    triggers.push({
      type: "missed_workout",
      reason: `Key workout(s) completed at only ${Math.round(ratio * 100)}% of planned distance — training stimulus likely not achieved.`,
      severity: ratio < 0.4 ? "high" : "medium",
      metric: "workout_execution_ratio",
      value: ratio,
      threshold: THRESHOLDS.UNDER_EXECUTION_RATIO,
    });
  }

  // ── Stress increasing (still from trends — derived metrics don't replace this) ─
  const stressTrend = trends.find((t) => t.metric === "stress");
  if (
    stressTrend &&
    stressTrend.direction === "up" &&
    stressTrend.changePercent > THRESHOLDS.STRESS_INCREASE_PERCENT
  ) {
    triggers.push({
      type: "poor_recovery",
      reason: `Stress levels increasing ${stressTrend.changePercent.toFixed(1)}% above baseline (${stressTrend.baseline28dAvg} → ${stressTrend.current7dAvg}).`,
      severity: "medium",
      metric: "stress",
      value: stressTrend.changePercent,
      threshold: THRESHOLDS.STRESS_INCREASE_PERCENT,
    });
  }

  // ── Weekly load spike (Blanch & Gabbett, 2015) — independent of ACWR ──
  if (weeklyLoadSpike?.spikePercent != null) {
    if (weeklyLoadSpike.spikePercent >= THRESHOLDS.WEEKLY_LOAD_SPIKE_HIGH) {
      triggers.push({
        type: "poor_recovery",
        reason: `Weekly load spike: ${weeklyLoadSpike.spikePercent.toFixed(0)}% increase from last week (threshold: ${THRESHOLDS.WEEKLY_LOAD_SPIKE_HIGH}%). Sharp single-week ramp (Gabbett 2015 heuristic), independent of ACWR status.`,
        severity: "high",
        metric: "weeklyLoadSpike",
        value: weeklyLoadSpike.spikePercent,
        threshold: THRESHOLDS.WEEKLY_LOAD_SPIKE_HIGH,
      });
    } else if (weeklyLoadSpike.spikePercent >= THRESHOLDS.WEEKLY_LOAD_SPIKE_CAUTION) {
      triggers.push({
        type: "poor_recovery",
        reason: `Weekly load increasing rapidly: ${weeklyLoadSpike.spikePercent.toFixed(0)}% above last week — approaching spike threshold (${THRESHOLDS.WEEKLY_LOAD_SPIKE_HIGH}%). Limit further load increases this week.`,
        severity: "medium",
        metric: "weeklyLoadSpike",
        value: weeklyLoadSpike.spikePercent,
        threshold: THRESHOLDS.WEEKLY_LOAD_SPIKE_CAUTION,
      });
    }
  }

  // ── RPE overreach (Foster, 1998) — perceived effort independent of HR ─
  if (rpeFatigue && rpeFatigue.dataPoints >= 2) {
    const avgRpe = rpeFatigue.sevenDayAvgRpe;
    if (avgRpe != null && avgRpe >= THRESHOLDS.RPE_CRITICAL) {
      triggers.push({
        type: "poor_recovery",
        reason: `RPE critically high: avg ${avgRpe.toFixed(1)}/10 over 7 days (threshold: ${THRESHOLDS.RPE_CRITICAL}). Neuromuscular overreach — reduce intensity immediately.`,
        severity: "high",
        metric: "rpeScore",
        value: avgRpe,
        threshold: THRESHOLDS.RPE_CRITICAL,
      });
    } else if (avgRpe != null && avgRpe >= THRESHOLDS.RPE_ELEVATED) {
      triggers.push({
        type: "poor_recovery",
        reason: `RPE elevated: avg ${avgRpe.toFixed(1)}/10 over 7 days (threshold: ${THRESHOLDS.RPE_ELEVATED}). Sessions perceived as harder than typical — consider reducing intensity.`,
        severity: "medium",
        metric: "rpeScore",
        value: avgRpe,
        threshold: THRESHOLDS.RPE_ELEVATED,
      });
    }
  }

  // ── Positive signals ─────────────────────────────────────────────────
  if (
    recovery.score != null &&
    recovery.score >= 80 &&
    acwr.riskBand === "optimal"
  ) {
    triggers.push({
      type: "weekly_review",
      reason: `Recovery ${recovery.score}/100 + ACWR ${acwr.ratio?.toFixed(2)} in optimal zone. Athlete may be ready for progression.`,
      severity: "low",
      metric: "readyForProgression",
    });
  }

  if (acwr.riskBand === "undertrained" && acwr.chronicSessions >= 4) {
    triggers.push({
      type: "weekly_review",
      reason: `ACWR ${acwr.ratio?.toFixed(2) ?? "N/A"} indicates undertrained. Safe to increase load gradually.`,
      severity: "low",
      metric: "acwr",
      value: acwr.ratio ?? undefined,
    });
  }

  // ── Determine overall severity ───────────────────────────────────────
  const shouldAdapt = triggers.some(
    (t) => t.severity === "high" || t.severity === "medium",
  );

  let severity: DecisionResult["severity"] = "low";
  if (triggers.some((t) => t.severity === "high")) {
    severity = "high";
  } else if (triggers.some((t) => t.severity === "medium")) {
    severity = "medium";
  }

  return { shouldAdapt, triggers, severity };
}
