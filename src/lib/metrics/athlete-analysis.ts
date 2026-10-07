/**
 * Athlete analysis assembly module.
 *
 * Composes all derived metrics into a structured AthleteAnalysis object
 * with actionable flags. This is the primary input sent to the AI —
 * replacing raw data dumps with a pre-interpreted athlete profile.
 */

import type { Database } from "@/lib/db";
import {
  calculateACWR,
  calculateRecoveryReadiness,
  calculateSleepQuality,
  calculatePaceEfficiency,
  calculateWeeklyLoadSpike,
  calculateRPEFatigue,
  calculateCadenceTrend,
  type ACWRResult,
  type RecoveryReadinessResult,
  type SleepQualityResult,
  type PaceEfficiencyResult,
  type WeeklyLoadSpikeResult,
  type RPEFatigueSummary,
  type CadenceTrendResult,
} from "./derived";
import { calculateBaseline } from "./baseline";
import { calculateTrends } from "./trends";
import type { MetricsBaseline, MetricsTrend } from "@/types/metrics";
import { cacheGet, cacheSet, analysisKey } from "@/lib/cache/redis";
import { getStoredResponseProfile, type ResponseProfile } from "./response-patterns";
import { calculateWorkoutPreferences, type WorkoutPreferenceSummary } from "./workout-preference";

/** Cache TTL for athlete analysis (6 hours) */
const ANALYSIS_CACHE_TTL_SECONDS = 6 * 60 * 60;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FlagCategory =
  | "injury_risk"
  | "recovery"
  | "performance"
  | "sleep"
  | "training_load"
  | "compliance";

export type FlagType = "warning" | "opportunity" | "info";
export type FlagSeverity = "high" | "medium" | "low";

export interface AnalysisFlag {
  type: FlagType;
  category: FlagCategory;
  message: string;
  severity: FlagSeverity;
}

export interface AthleteAnalysis {
  /** When this analysis was computed */
  computedAt: string;
  /** ACWR and training load risk */
  acwr: ACWRResult;
  /** Recovery readiness composite score */
  recovery: RecoveryReadinessResult;
  /** Detailed sleep quality (null if no sleep data) */
  sleepQuality: SleepQualityResult | null;
  /** Pace efficiency trends */
  paceEfficiency: PaceEfficiencyResult;
  /** 28-day rolling baseline averages */
  baseline: MetricsBaseline;
  /** 7d vs 28d metric trends */
  trends: MetricsTrend[];
  /** Individual response patterns (null if not yet computed) */
  responseProfile: ResponseProfile | null;
  /**
   * Week-to-week load spike (Blanch & Gabbett, 2015).
   * Independent load-ramp signal: a ≥50% single-week spike warrants caution even when ACWR is optimal.
   */
  weeklyLoadSpike: WeeklyLoadSpikeResult;
  /**
   * RPE-based fatigue (Foster et al., 1998).
   * Session RPE captures neuromuscular fatigue and subjective effort invisible to HR-based TRIMP.
   */
  rpeFatigue: RPEFatigueSummary;
  /**
   * Workout preferences inferred from adaptation history and RPE signals.
   * Null when no planId is provided (e.g. initial plan generation).
   */
  workoutPreferences: WorkoutPreferenceSummary | null;
  /**
   * Run cadence trend (7d vs 28d). Low cadence suggests overstriding;
   * a drop late in a block can indicate accumulating fatigue.
   */
  cadenceTrend: CadenceTrendResult;
  /** Actionable flags derived from all metrics */
  flags: AnalysisFlag[];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Build a complete athlete analysis from all available health/activity data.
 *
 * This is the top-level function called before AI plan generation or adaptation.
 * All derived metrics are computed in parallel for performance.
 *
 * Results are cached in Redis with a 6h TTL. Multiple adaptation triggers
 * within 6 hours reuse the cached analysis instead of recomputing from DB.
 */
export async function buildAthleteAnalysis(
  db: Database,
  userId: string,
  asOf: Date = new Date(),
  planId?: string,
): Promise<AthleteAnalysis> {
  // Check cache first
  const cached = await cacheGet<AthleteAnalysis>(analysisKey(userId, planId));
  if (cached) {
    console.log(`[analysis] Cache hit for user ${userId} (computed at ${cached.computedAt})`);
    return cached;
  }

  // Compute all metrics in parallel (including stored response patterns)
  const [acwr, recovery, sleepQuality, paceEfficiency, baseline, trends, responseProfile, weeklyLoadSpike, rpeFatigue, cadenceTrend] =
    await Promise.all([
      calculateACWR(db, userId, asOf),
      calculateRecoveryReadiness(db, userId, asOf),
      calculateSleepQuality(db, userId, asOf),
      calculatePaceEfficiency(db, userId, asOf),
      calculateBaseline(db, userId, asOf),
      calculateTrends(db, userId, asOf),
      getStoredResponseProfile(db, userId),
      calculateWeeklyLoadSpike(db, userId, asOf),
      calculateRPEFatigue(db, userId, asOf),
      calculateCadenceTrend(db, userId, asOf),
    ]);

  // Workout preferences require a planId — computed separately since it's optional
  const workoutPreferences = planId
    ? await calculateWorkoutPreferences(db, userId, planId, asOf)
    : null;

  // Generate actionable flags from all metrics
  const flags = generateFlags(acwr, recovery, sleepQuality, paceEfficiency, trends, responseProfile, weeklyLoadSpike, rpeFatigue, cadenceTrend);

  const analysis: AthleteAnalysis = {
    computedAt: asOf.toISOString(),
    acwr,
    recovery,
    sleepQuality,
    paceEfficiency,
    baseline,
    trends,
    responseProfile,
    weeklyLoadSpike,
    rpeFatigue,
    workoutPreferences,
    cadenceTrend,
    flags,
  };

  // Cache for 6 hours (best-effort, non-blocking)
  void cacheSet(analysisKey(userId, planId), analysis, ANALYSIS_CACHE_TTL_SECONDS);

  return analysis;
}

/**
 * Invalidate the cached analysis for a user.
 * Call this when new health data arrives (e.g., after webhook processing).
 */
export async function invalidateAnalysisCache(userId: string): Promise<void> {
  const { cacheDelByPrefix } = await import("@/lib/cache/redis");
  await cacheDelByPrefix(analysisKey(userId));
}

// ---------------------------------------------------------------------------
// Flag generation
// ---------------------------------------------------------------------------

function generateFlags(
  acwr: ACWRResult,
  recovery: RecoveryReadinessResult,
  sleepQuality: SleepQualityResult | null,
  paceEfficiency: PaceEfficiencyResult,
  trends: MetricsTrend[],
  responseProfile: ResponseProfile | null,
  weeklyLoadSpike: WeeklyLoadSpikeResult,
  rpeFatigue: RPEFatigueSummary,
  cadenceTrend: CadenceTrendResult,
): AnalysisFlag[] {
  const flags: AnalysisFlag[] = [];

  // --- Weekly load spike flags (Blanch & Gabbett, 2015) ---
  if (weeklyLoadSpike.riskBand === "spike") {
    flags.push({
      type: "warning",
      category: "injury_risk",
      message: `Weekly load spike: ${weeklyLoadSpike.spikePercent?.toFixed(0)}% increase from last week (≥50% threshold per Gabbett, 2015). Sharp single-week ramp — reduce next week's load.`,
      severity: "high",
    });
  } else if (weeklyLoadSpike.riskBand === "caution") {
    flags.push({
      type: "warning",
      category: "injury_risk",
      message: `Weekly load increasing ${weeklyLoadSpike.spikePercent?.toFixed(0)}% above last week — approaching spike zone. Monitor for early signs of overreach.`,
      severity: "medium",
    });
  }

  // --- ACWR flags ---
  if (acwr.riskBand === "high_risk") {
    flags.push({
      type: "warning",
      category: "injury_risk",
      message: `ACWR ${acwr.ratio?.toFixed(2)} — load ramping much faster than the chronic base. Do not increase intensity.`,
      severity: "high",
    });
  } else if (acwr.riskBand === "caution") {
    flags.push({
      type: "warning",
      category: "injury_risk",
      message: `ACWR ${acwr.ratio?.toFixed(2)} — approaching overreach. Limit load increases.`,
      severity: "medium",
    });
  } else if (acwr.riskBand === "undertrained") {
    flags.push({
      type: "info",
      category: "training_load",
      message: `ACWR ${acwr.ratio?.toFixed(2) ?? "N/A"} — undertrained. Gradual load increase is safe.`,
      severity: "low",
    });
  }

  // --- Recovery readiness flags ---
  if (recovery.status === "depleted") {
    flags.push({
      type: "warning",
      category: "recovery",
      message: `Recovery readiness ${recovery.score}/100 — depleted. Easy training only.`,
      severity: "high",
    });
  } else if (recovery.status === "fatigued") {
    flags.push({
      type: "warning",
      category: "recovery",
      message: `Recovery readiness ${recovery.score}/100 — fatigued. Reduce intensity.`,
      severity: "medium",
    });
  } else if (
    recovery.status === "ready" &&
    recovery.score != null &&
    recovery.score >= 80
  ) {
    flags.push({
      type: "opportunity",
      category: "performance",
      message: `Recovery readiness ${recovery.score}/100 — well recovered. May support quality sessions.`,
      severity: "low",
    });
  }

  // --- Sleep quality flags ---
  if (sleepQuality) {
    if (sleepQuality.architecture === "poor") {
      flags.push({
        type: "warning",
        category: "sleep",
        message: `Sleep architecture: poor (deep ${sleepQuality.composition.deepPercent}%, REM ${sleepQuality.composition.remPercent}%).`,
        severity: "medium",
      });
    }

    if (sleepQuality.durationAdequacy === "short") {
      flags.push({
        type: "warning",
        category: "sleep",
        message: `Sleep duration ${sleepQuality.durationHours}h — below 7h recommendation.`,
        severity: sleepQuality.durationHours < 6 ? "high" : "medium",
      });
    }

    if (
      sleepQuality.weeklyTrend != null &&
      sleepQuality.index > 0 &&
      sleepQuality.weeklyTrend - sleepQuality.index > 10
    ) {
      flags.push({
        type: "warning",
        category: "sleep",
        message: `Sleep quality declining: today ${sleepQuality.index} vs 7-day avg ${sleepQuality.weeklyTrend}.`,
        severity: "medium",
      });
    }
  }

  // --- Pace efficiency flags ---
  if (paceEfficiency.changePercent != null) {
    if (paceEfficiency.changePercent < -5) {
      flags.push({
        type: "opportunity",
        category: "performance",
        message: `Pace efficiency improving ${Math.abs(paceEfficiency.changePercent).toFixed(1)}% — aerobic fitness trending up.`,
        severity: "low",
      });
    } else if (paceEfficiency.changePercent > 10) {
      flags.push({
        type: "warning",
        category: "performance",
        message: `Pace efficiency declining ${paceEfficiency.changePercent.toFixed(1)}% — possible fatigue or cardiac drift.`,
        severity: "medium",
      });
    }
  }

  if (paceEfficiency.paceCV != null && paceEfficiency.paceCV > 15) {
    flags.push({
      type: "info",
      category: "performance",
      message: `Pace consistency CV ${paceEfficiency.paceCV.toFixed(1)}% — variable effort across runs.`,
      severity: "low",
    });
  }

  // --- HRV trend flags ---
  const hrvTrend = trends.find((t) => t.metric === "hrv");
  if (hrvTrend && hrvTrend.direction === "up" && hrvTrend.changePercent > 8) {
    flags.push({
      type: "opportunity",
      category: "recovery",
      message: `HRV trending up ${hrvTrend.changePercent.toFixed(1)}% — may support faster progression.`,
      severity: "low",
    });
  }

  // --- Response profile flags ---
  if (responseProfile) {
    if (responseProfile.responseType === "volume_responder") {
      flags.push({
        type: "info",
        category: "training_load",
        message: "Volume responder — prioritize mileage increases over intensity for progression.",
        severity: "low",
      });
    } else if (responseProfile.responseType === "intensity_responder") {
      flags.push({
        type: "info",
        category: "training_load",
        message: "Intensity responder — prioritize quality sessions over volume increases.",
        severity: "low",
      });
    }

    if (responseProfile.hrvRecoveryAfterIntervals != null && responseProfile.hrvRecoveryAfterIntervals > 72) {
      flags.push({
        type: "warning",
        category: "recovery",
        message: `Slow HRV recovery after intervals (${Math.round(responseProfile.hrvRecoveryAfterIntervals)}h) — allow 3+ days between hard sessions.`,
        severity: "medium",
      });
    }

    if (responseProfile.optimalHardDays.length > 0) {
      flags.push({
        type: "info",
        category: "training_load",
        message: `Optimal hard session days: ${responseProfile.optimalHardDays.slice(0, 3).join(", ")}.`,
        severity: "low",
      });
    }
  }

  // --- RPE fatigue flags (Foster, 1998) ---
  if (rpeFatigue.dataPoints > 0) {
    const avgRpe = rpeFatigue.sevenDayAvgRpe;
    if (avgRpe != null && avgRpe >= 9) {
      flags.push({
        type: "warning",
        category: "recovery",
        message: `RPE critically high: avg ${avgRpe.toFixed(1)}/10 over 7 days. Sessions likely too intense — neuromuscular fatigue risk.`,
        severity: "high",
      });
    } else if (avgRpe != null && avgRpe >= 8) {
      flags.push({
        type: "warning",
        category: "recovery",
        message: `RPE elevated: avg ${avgRpe.toFixed(1)}/10 over 7 days. Monitor for accumulated fatigue — consider reducing intensity.`,
        severity: "medium",
      });
    }

    if (rpeFatigue.trend === "rising" && rpeFatigue.baselineAvgRpe != null) {
      flags.push({
        type: "warning",
        category: "training_load",
        message: `RPE trend rising: 7-day avg ${rpeFatigue.sevenDayAvgRpe?.toFixed(1)} vs 28-day baseline ${rpeFatigue.baselineAvgRpe.toFixed(1)}. Same pace requires more effort — possible fatigue accumulation.`,
        severity: "medium",
      });
    }
  }

  // --- Cadence flags (form / fatigue signal) ---
  if (cadenceTrend.runCount >= 4 && cadenceTrend.baseline28dAvg != null) {
    if (cadenceTrend.baseline28dAvg < 160) {
      flags.push({
        type: "info",
        category: "performance",
        message: `Average run cadence ${cadenceTrend.baseline28dAvg.toFixed(0)} spm is on the low side — often a sign of overstriding. A gradual ~5% cadence increase reduces impact loading without hurting economy. Suggest drills/cues, not a fixed "180" target.`,
        severity: "low",
      });
    }
    if (cadenceTrend.changePercent != null && cadenceTrend.changePercent <= -4) {
      flags.push({
        type: "info",
        category: "performance",
        message: `Run cadence down ${Math.abs(cadenceTrend.changePercent).toFixed(0)}% vs 28-day baseline — form is degrading, often a fatigue signal when paired with rising RPE.`,
        severity: "low",
      });
    }
  }

  // Sort flags: high severity first, then medium, then low
  const severityOrder: Record<FlagSeverity, number> = {
    high: 0,
    medium: 1,
    low: 2,
  };
  flags.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return flags;
}

// ---------------------------------------------------------------------------
// Formatted summary for AI prompts
// ---------------------------------------------------------------------------

/**
 * Format the athlete analysis into a concise text summary for AI prompts.
 * This replaces the raw data dump, reducing token count while improving
 * the quality of information sent to the model.
 */
export function formatAnalysisForPrompt(analysis: AthleteAnalysis): string {
  const lines: string[] = [];

  // ACWR
  lines.push("## Training Load (ACWR)");
  lines.push(
    `Acute: ${analysis.acwr.acuteLoad} · Chronic: ${analysis.acwr.chronicLoad} · ` +
      `Ratio: ${analysis.acwr.ratio?.toFixed(2) ?? "N/A"} (${analysis.acwr.riskBand.replace("_", " ")})`,
  );
  lines.push(
    `Sessions: ${analysis.acwr.acuteSessions} (7d) / ${analysis.acwr.chronicSessions} (28d)`,
  );

  // Weekly load spike
  lines.push("\n## Weekly Load Spike (Blanch & Gabbett, 2015)");
  const wls = analysis.weeklyLoadSpike;
  lines.push(
    `This week: ${wls.currentWeekLoad} TRIMP (${wls.sessionsCurrentWeek} sessions) · ` +
      `Last week: ${wls.previousWeekLoad} TRIMP (${wls.sessionsPreviousWeek} sessions) · ` +
      `Change: ${wls.spikePercent != null ? wls.spikePercent.toFixed(0) + "%" : "N/A"} (${wls.riskBand})`,
  );

  // Recovery
  lines.push("\n## Recovery Readiness");
  if (analysis.recovery.score == null) {
    lines.push(
      "Unknown — no recovery data available (HRV, sleep, body battery, stress all missing). Do not infer fatigue or readiness.",
    );
  } else {
    lines.push(
      `Score: ${analysis.recovery.score}/100 (${analysis.recovery.status})` +
        (analysis.recovery.confidence === "partial"
          ? " — partial data, rescaled from available components"
          : ""),
    );
    const { components } = analysis.recovery;
    lines.push(
      `HRV: ${components.hrv}/25 · Sleep: ${components.sleep}/25 · ` +
        `Body Battery: ${components.bodyBattery}/25 · Stress: ${components.stress}/25`,
    );
  }
  if (analysis.recovery.missingData.length > 0) {
    lines.push(`Missing data: ${analysis.recovery.missingData.join(", ")}`);
  }

  // Sleep
  if (analysis.sleepQuality) {
    const sq = analysis.sleepQuality;
    lines.push("\n## Sleep Quality");
    lines.push(
      `Index: ${sq.index}/100 · Architecture: ${sq.architecture} · Duration: ${sq.durationHours}h (${sq.durationAdequacy})`,
    );
    lines.push(
      `Deep: ${sq.composition.deepPercent}% · REM: ${sq.composition.remPercent}% · ` +
        `Light: ${sq.composition.lightPercent}% · Awake: ${sq.composition.awakePercent}%`,
    );
    if (sq.weeklyTrend != null) {
      lines.push(`7-day trend: ${sq.weeklyTrend}`);
    }
  }

  // Pace efficiency
  if (analysis.paceEfficiency.runCount > 0) {
    const pe = analysis.paceEfficiency;
    lines.push("\n## Pace Efficiency");
    lines.push(
      `Current ratio: ${pe.currentRatio?.toFixed(2) ?? "N/A"} · ` +
        `Baseline: ${pe.baselineRatio?.toFixed(2) ?? "N/A"} · ` +
        `Change: ${pe.changePercent != null ? pe.changePercent.toFixed(1) + "%" : "N/A"}`,
    );
    if (pe.paceCV != null) {
      lines.push(`Pace consistency (CV): ${pe.paceCV.toFixed(1)}%`);
    }
  }

  // Baseline
  lines.push("\n## 28-Day Baseline");
  const b = analysis.baseline;
  const baselineParts: string[] = [];
  if (b.hrvAvg != null) baselineParts.push(`HRV: ${b.hrvAvg}ms`);
  if (b.sleepScoreAvg != null) baselineParts.push(`Sleep: ${b.sleepScoreAvg}`);
  if (b.restingHRAvg != null) baselineParts.push(`RHR: ${b.restingHRAvg}bpm`);
  if (b.stressAvg != null) baselineParts.push(`Stress: ${b.stressAvg}`);
  if (b.bodyBatteryStartAvg != null)
    baselineParts.push(`Body Battery: ${b.bodyBatteryStartAvg}`);
  lines.push(baselineParts.join(" · ") || "No baseline data available");
  lines.push(`Data points: ${b.dataPoints} (${b.fromDate} to ${b.toDate})`);

  // RPE fatigue
  if (analysis.rpeFatigue.dataPoints > 0) {
    const rpe = analysis.rpeFatigue;
    lines.push("\n## Perceived Effort (Foster RPE Method)");
    lines.push(
      `7-day avg RPE: ${rpe.sevenDayAvgRpe?.toFixed(1) ?? "N/A"}/10 · ` +
        `28-day baseline: ${rpe.baselineAvgRpe?.toFixed(1) ?? "N/A"}/10 · ` +
        `Trend: ${rpe.trend} · Foster load: ${rpe.fosterSessionLoad} RPE·min · ` +
        `Sessions with RPE: ${rpe.dataPoints}`,
    );
  }

  // Cadence trend (form signal)
  const ct = analysis.cadenceTrend;
  if (ct.runCount >= 4 && ct.baseline28dAvg != null) {
    lines.push("\n## Run Cadence");
    lines.push(
      `7-day avg: ${ct.current7dAvg?.toFixed(0) ?? "N/A"} spm · ` +
        `28-day baseline: ${ct.baseline28dAvg.toFixed(0)} spm · ` +
        `Change: ${ct.changePercent != null ? `${ct.changePercent > 0 ? "+" : ""}${ct.changePercent.toFixed(1)}%` : "N/A"} · ` +
        `Runs with data: ${ct.runCount}`,
    );
  }

  // Response profile
  if (analysis.responseProfile) {
    const rp = analysis.responseProfile;
    lines.push("\n## Individual Response Profile");
    const rpParts: string[] = [];
    rpParts.push(`Type: ${rp.responseType}`);
    if (rp.hrvRecoveryAfterIntervals != null)
      rpParts.push(`HRV recovery (intervals): ${Math.round(rp.hrvRecoveryAfterIntervals)}h`);
    if (rp.hrvRecoveryAfterLongRuns != null)
      rpParts.push(`HRV recovery (long runs): ${Math.round(rp.hrvRecoveryAfterLongRuns)}h`);
    if (rp.paceHrDecouplingRate != null)
      rpParts.push(`Decoupling: ${rp.paceHrDecouplingRate.toFixed(1)}%/30min`);
    lines.push(rpParts.join(" · "));
    if (rp.optimalHardDays.length > 0) {
      lines.push(`Optimal hard days: ${rp.optimalHardDays.join(", ")}`);
    }
  }

  // Workout preferences (adaptation history + RPE signals)
  if (analysis.workoutPreferences && analysis.workoutPreferences.adaptationDataPoints > 0) {
    const wp = analysis.workoutPreferences;
    lines.push("\n## Athlete Preferences (inferred from feedback history)");
    const acceptStr = wp.acceptanceRate != null
      ? `${(wp.acceptanceRate * 100).toFixed(0)}% (${wp.acceptedCount} accepted, ${wp.rejectedCount} rejected)`
      : "insufficient data";
    lines.push(`Adaptation acceptance rate: ${acceptStr}`);
    if (wp.highRpeWorkoutTypes.length > 0) {
      lines.push(`Consistently high RPE (≥8): ${wp.highRpeWorkoutTypes.join(", ")} — athlete finds these workouts harder than expected`);
    }
    if (wp.wellExecutedWorkoutTypes.length > 0) {
      lines.push(`Well-executed (RPE 5-7): ${wp.wellExecutedWorkoutTypes.join(", ")}`);
    }
  }

  // Flags
  if (analysis.flags.length > 0) {
    lines.push("\n## Actionable Flags");
    for (const flag of analysis.flags) {
      const icon =
        flag.type === "warning" ? "⚠" : flag.type === "opportunity" ? "↑" : "→";
      lines.push(`${icon} [${flag.severity}] ${flag.message}`);
    }
  }

  return lines.join("\n");
}
