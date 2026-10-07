/**
 * Post-AI guardrails — validate generated plans against safety rules.
 *
 * These rules are checked AFTER the AI generates a plan and BEFORE
 * the plan is stored in the database. The guardrails can issue warnings
 * and automatically adjust the plan where possible.
 *
 * Includes science-backed checks:
 * - ACWR guardrail (Hulin et al., 2014)
 * - Gray zone / polarized training (Seiler, 2010)
 * - Recovery-informed hard session spacing
 */

import type {
  PlanGenerationOutput,
  GeneratedWeek,
  GeneratedWorkout,
  WorkoutType,
} from "@/types/plan";
import type { ACWRResult, RecoveryReadinessResult } from "@/lib/metrics/derived";
import type { HealthConstraint } from "@/types/health";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GuardrailResult {
  valid: boolean;
  warnings: string[];
  adjustments: GuardrailAdjustment[];
  /**
   * Structured violations for adversarial regeneration.
   * Each entry is a prompt-injectable constraint directive that Claude can
   * follow to produce a globally coherent plan rather than a mechanically patched one.
   */
  violations: GuardrailViolation[];
  /** The (possibly adjusted) plan output */
  plan: PlanGenerationOutput;
}

export interface GuardrailAdjustment {
  weekNumber: number;
  rule: string;
  description: string;
  before?: unknown;
  after?: unknown;
}

export interface GuardrailViolation {
  rule: string;
  /** One-line constraint the AI must satisfy in a regenerated plan */
  directive: string;
}

/** Optional athlete context for derived-metric-based guardrails. */
export interface AthleteGuardrailContext {
  acwr?: ACWRResult;
  recovery?: RecoveryReadinessResult;
}

// Volume-progression caps are deliberately excluded: the "10% rule" lacks RCT
// support (GRONORUN), so those get a mechanical cap rather than a second
// full-cost generation call.
export const SIGNIFICANT_VIOLATION_RULES: ReadonlySet<string> = new Set([
  "acwr_overload",
  "acwr_high_risk_mileage_cap",
]);

export function significantViolations(
  violations: GuardrailViolation[],
): GuardrailViolation[] {
  return violations.filter((v) => SIGNIFICANT_VIOLATION_RULES.has(v.rule));
}

// ---------------------------------------------------------------------------
// Workout type classification
// ---------------------------------------------------------------------------

const HARD_WORKOUT_TYPES: Set<WorkoutType> = new Set([
  "tempo",
  "intervals",
  "hill_repeats",
  "race_pace",
  "fartlek",
]);

/**
 * "Gray zone" workout types: moderate effort that's neither easy nor truly hard.
 * Seiler's polarized model suggests minimizing these.
 */
const GRAY_ZONE_TYPES: Set<WorkoutType> = new Set(["tempo", "fartlek"]);

export function isHardWorkout(type: WorkoutType): boolean {
  return HARD_WORKOUT_TYPES.has(type);
}

export function isRunningWorkout(type: WorkoutType): boolean {
  return type !== "rest" && type !== "cross_training";
}

// ---------------------------------------------------------------------------
// Mileage estimation from workout
// ---------------------------------------------------------------------------

/**
 * Estimate the distance of a workout in km from its steps or target.
 */
export function estimateWorkoutDistanceKm(workout: GeneratedWorkout): number {
  if (workout.targetDistanceMeters) {
    return workout.targetDistanceMeters / 1000;
  }

  // Try to sum up from steps
  let totalMeters = 0;
  for (const step of workout.steps) {
    if (step.type === "interval") {
      const workDist = step.workStep.durationType === "distance" ? (step.workStep.durationValue ?? 0) : 0;
      const restDist = step.restStep.durationType === "distance" ? (step.restStep.durationValue ?? 0) : 0;
      totalMeters += (workDist + restDist) * step.repeatCount;
    } else {
      if (step.durationType === "distance") {
        totalMeters += step.durationValue ?? 0;
      } else if (step.durationType === "time" && step.durationValue) {
        // Estimate distance from time: assume ~6:00/km (360 sec/km) as average
        totalMeters += (step.durationValue / 360) * 1000;
      }
    }
  }

  return totalMeters / 1000;
}

/**
 * Calculate total weekly running mileage in km.
 */
function weeklyRunningMileageKm(week: GeneratedWeek): number {
  return week.workouts
    .filter((w) => isRunningWorkout(w.type))
    .reduce((sum, w) => sum + estimateWorkoutDistanceKm(w), 0);
}

// ---------------------------------------------------------------------------
// Days of week ordering
// ---------------------------------------------------------------------------

const DAY_ORDER: Record<string, number> = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6,
};

function dayIndex(day: string): number {
  return DAY_ORDER[day.toLowerCase()] ?? 0;
}

// ---------------------------------------------------------------------------
// Guardrail checks
// ---------------------------------------------------------------------------

/**
 * Run all guardrail checks on a generated plan.
 *
 * @param plan - The AI-generated plan output.
 * @param currentWeeklyMileageKm - The runner's current weekly mileage (baseline).
 *   If unknown, the first week's target is used as the baseline.
 * @param experienceLevel - "beginner" or "experienced". Affects rest day requirements.
 * @param athleteContext - Optional derived metrics for ACWR/recovery guardrails.
 */
export function runGuardrails(
  plan: PlanGenerationOutput,
  currentWeeklyMileageKm?: number,
  experienceLevel: "beginner" | "experienced" = "experienced",
  athleteContext?: AthleteGuardrailContext,
  healthConstraints?: HealthConstraint[],
): GuardrailResult {
  const warnings: string[] = [];
  const adjustments: GuardrailAdjustment[] = [];
  const violations: GuardrailViolation[] = [];

  // Deep clone so we can modify
  const adjusted: PlanGenerationOutput = JSON.parse(JSON.stringify(plan));

  // ── 1. Weekly volume progression: banded cap vs last normal week ───
  // The classic "10% rule" is not evidence-backed as injury protection
  // (Buist et al., GRONORUN RCT: graded vs standard progression had near-
  // identical injury rates). We keep a progression cap as a conservative
  // heuristic, banded by experience: beginners 10%, experienced 20%.
  //
  // The baseline is the last NORMAL week. Step-back weeks (deliberate
  // 20-30% reductions every 3-4 weeks, mandated by the generation prompt)
  // must not lower the baseline — otherwise the week after a step-back is
  // capped at stepback × cap, mechanically forcing a sawtooth volume
  // decline that fights the plan's own periodization.
  const progressionCap = experienceLevel === "beginner" ? 1.1 : 1.2;
  const capPercent = Math.round((progressionCap - 1) * 100);
  let baselineMileage =
    currentWeeklyMileageKm ?? weeklyRunningMileageKm(adjusted.weeks[0]);

  for (let i = 1; i < adjusted.weeks.length; i++) {
    const week = adjusted.weeks[i];
    const mileage = week.weeklyMileageTargetKm;

    // Taper and race weeks reduce volume by design — exempt from the cap
    // and they never become the progression baseline.
    if (week.phase === "taper" || week.phase === "race_week") continue;

    const maxAllowed = baselineMileage * progressionCap;

    if (mileage > maxAllowed) {
      const capped = Math.round(maxAllowed * 10) / 10;
      warnings.push(
        `Week ${week.weekNumber}: mileage ${mileage}km exceeds ${capPercent}% increase (max ${capped}km from last normal week's ${baselineMileage.toFixed(1)}km). Capped.`,
      );
      adjustments.push({
        weekNumber: week.weekNumber,
        rule: "volume_progression_cap",
        description: `Capped weekly mileage from ${mileage}km to ${capped}km`,
        before: mileage,
        after: capped,
      });
      violations.push({
        rule: "volume_progression_cap",
        directive: `Week ${week.weekNumber} mileage must not exceed ${capped}km — progression cap (max ${capPercent}% above the last normal week's ${baselineMileage.toFixed(1)}km; step-back weeks don't reset the baseline).`,
      });
      adjusted.weeks[i].weeklyMileageTargetKm = capped;
    }

    // Only weeks at or above ~95% of the baseline advance it; lower-volume
    // weeks are treated as step-backs and leave the baseline untouched.
    const finalMileage = adjusted.weeks[i].weeklyMileageTargetKm;
    if (finalMileage >= baselineMileage * 0.95) {
      baselineMileage = finalMileage;
    }
  }

  // ── 2. Minimum rest days ───────────────────────────────────────────
  const minRestDays = experienceLevel === "beginner" ? 2 : 1;

  for (const week of adjusted.weeks) {
    const restCount = week.workouts.filter(
      (w) => w.type === "rest" || w.type === "cross_training",
    ).length;

    if (restCount < minRestDays) {
      warnings.push(
        `Week ${week.weekNumber}: only ${restCount} rest/cross-training day(s), minimum is ${minRestDays} for ${experienceLevel} runners.`,
      );
    }
  }

  // ── 3. 80/20 rule check ───────────────────────────────────────────
  for (const week of adjusted.weeks) {
    if (week.phase === "race_week") continue;

    const runWorkouts = week.workouts.filter((w) => isRunningWorkout(w.type));
    if (runWorkouts.length === 0) continue;

    const easyMileage = runWorkouts
      .filter((w) => !isHardWorkout(w.type))
      .reduce((sum, w) => sum + estimateWorkoutDistanceKm(w), 0);

    const totalMileage = runWorkouts.reduce(
      (sum, w) => sum + estimateWorkoutDistanceKm(w),
      0,
    );

    if (totalMileage > 0) {
      const easyPercent = (easyMileage / totalMileage) * 100;
      if (easyPercent < 70) {
        warnings.push(
          `Week ${week.weekNumber}: easy volume is only ${easyPercent.toFixed(0)}% (target: ~80%). Too much intensity.`,
        );
      }
    }
  }

  // ── 4. No consecutive hard days ───────────────────────────────────
  for (const week of adjusted.weeks) {
    const sorted = [...week.workouts].sort(
      (a, b) => dayIndex(a.day) - dayIndex(b.day),
    );

    for (let i = 0; i < sorted.length - 1; i++) {
      const currentDay = dayIndex(sorted[i].day);
      const nextDay = dayIndex(sorted[i + 1].day);

      if (
        nextDay - currentDay === 1 &&
        isHardWorkout(sorted[i].type) &&
        isHardWorkout(sorted[i + 1].type)
      ) {
        warnings.push(
          `Week ${week.weekNumber}: consecutive hard workouts on ${sorted[i].day} (${sorted[i].type}) and ${sorted[i + 1].day} (${sorted[i + 1].type}).`,
        );
      }
    }
  }

  // ── 5. Long run % of weekly volume ────────────────────────────────
  for (const week of adjusted.weeks) {
    const longRun = week.workouts.find((w) => w.type === "long_run");
    if (!longRun) continue;

    const totalMileage = weeklyRunningMileageKm(week);
    if (totalMileage <= 0) continue;

    const longRunKm = estimateWorkoutDistanceKm(longRun);
    const longRunPercent = (longRunKm / totalMileage) * 100;

    if (longRunPercent > 40) {
      warnings.push(
        `Week ${week.weekNumber}: long run (${longRunKm.toFixed(1)}km) is ${longRunPercent.toFixed(0)}% of weekly volume. Should be 25-35%.`,
      );
    }
  }

  // ── 6. Taper shape (Bosquet 2007: exponential volume reduction of
  //      41-60% by race week, intensity and frequency held) ───────────
  const taperWeeks = adjusted.weeks.filter((w) => w.phase === "taper");
  const peakWeeks = adjusted.weeks.filter((w) => w.phase === "peak");

  if (taperWeeks.length > 0 && peakWeeks.length > 0) {
    const peakAvgMileage =
      peakWeeks.reduce((sum, w) => sum + w.weeklyMileageTargetKm, 0) /
      peakWeeks.length;

    for (let t = 0; t < taperWeeks.length; t++) {
      const taperWeek = taperWeeks[t];
      const reductionPercent =
        ((peakAvgMileage - taperWeek.weeklyMileageTargetKm) / peakAvgMileage) *
        100;

      // The FINAL taper week should reach the evidence-based 41-60% cut;
      // earlier taper weeks step down progressively (≥20%).
      const isFinalTaperWeek = t === taperWeeks.length - 1;
      const minReduction = isFinalTaperWeek ? 40 : 20;

      if (reductionPercent < minReduction) {
        warnings.push(
          `Week ${taperWeek.weekNumber} (taper): only ${reductionPercent.toFixed(0)}% volume reduction from peak. ` +
            (isFinalTaperWeek
              ? `Final taper week should cut 41-60% of peak volume while keeping intensity and session frequency.`
              : `Early taper weeks should cut at least 20%, stepping down toward 41-60% by race week.`),
        );
      }

      // A taper that guts intensity loses fitness without adding freshness —
      // the evidence says reduce VOLUME, keep intensity touches.
      if (isFinalTaperWeek) {
        const hasQualityTouch = taperWeek.workouts.some((w) =>
          isHardWorkout(w.type),
        );
        if (!hasQualityTouch) {
          warnings.push(
            `Week ${taperWeek.weekNumber} (taper): no quality session. Tapers should hold intensity (short race-pace touches) while cutting volume.`,
          );
        }
      }
    }
  }

  // ── 7. ACWR guardrail — block intensity increases when overloaded ──
  if (athleteContext?.acwr) {
    const { acwr } = athleteContext;

    if (acwr.ratio != null && acwr.ratio > 1.3) {
      // Check if week 1 has more hard sessions than what's safe
      const firstWeek = adjusted.weeks[0];
      if (firstWeek) {
        const hardCount = firstWeek.workouts.filter((w) =>
          isHardWorkout(w.type),
        ).length;

        if (hardCount > 1) {
          warnings.push(
            `Week ${firstWeek.weekNumber}: ACWR ${acwr.ratio.toFixed(2)} is in ${acwr.riskBand} zone. ` +
              `${hardCount} hard sessions planned — limit to 1 until the load ramp settles below 1.3.`,
          );
          violations.push({
            rule: "acwr_overload",
            directive: `Week ${firstWeek.weekNumber} must contain at most 1 hard session — ACWR ${acwr.ratio.toFixed(2)} exceeds 1.3 (load ramping faster than the chronic base). Replace extra hard sessions with easy runs.`,
          });

          // Auto-adjust: downgrade extra hard sessions to easy runs
          let downgraded = 0;
          for (const workout of adjusted.weeks[0].workouts) {
            if (downgraded >= hardCount - 1) break;
            // race_pace is never auto-downgraded (race-week prep must survive),
            // so a week with 2+ race_pace sessions outlives the mechanical
            // patch — surfaced via warnings, accepted for race weeks.
            if (isHardWorkout(workout.type) && workout.type !== "race_pace") {
              const originalType = workout.type;
              workout.type = "easy_run";
              workout.title = `Easy run (reduced from ${originalType} — ACWR ${acwr.ratio.toFixed(2)})`;
              adjustments.push({
                weekNumber: firstWeek.weekNumber,
                rule: "acwr_overload",
                description: `Downgraded ${originalType} to easy_run (ACWR ${acwr.ratio.toFixed(2)})`,
                before: originalType,
                after: "easy_run",
              });
              downgraded++;
            }
          }
        }
      }

      // Block mileage increase in week 1 if ACWR > 1.5
      if (acwr.ratio > 1.5 && adjusted.weeks.length > 1) {
        const week1Mileage = adjusted.weeks[0].weeklyMileageTargetKm;
        const week2Mileage = adjusted.weeks[1].weeklyMileageTargetKm;
        if (week2Mileage > week1Mileage) {
          warnings.push(
            `Week 2: mileage increase blocked. ACWR ${acwr.ratio.toFixed(2)} — load is ramping much faster than the chronic base; ` +
              `holding at ${week1Mileage}km until recovery improves.`,
          );
          adjusted.weeks[1].weeklyMileageTargetKm = week1Mileage;
          adjustments.push({
            weekNumber: adjusted.weeks[1].weekNumber,
            rule: "acwr_high_risk_mileage_cap",
            description: `Capped mileage to ${week1Mileage}km (ACWR > 1.5)`,
            before: week2Mileage,
            after: week1Mileage,
          });
          violations.push({
            rule: "acwr_high_risk_mileage_cap",
            directive: `Week ${adjusted.weeks[1].weekNumber} mileage must not exceed ${week1Mileage}km — ACWR ${acwr.ratio.toFixed(2)} (>1.5) means load is ramping much faster than the chronic base; hold load steady.`,
          });
        }
      }
    }
  }

  // ── 8. Gray zone guardrail (Seiler's polarized model) ──────────────
  for (const week of adjusted.weeks) {
    if (week.phase === "race_week") continue;

    const grayZoneWorkouts = week.workouts.filter((w) =>
      GRAY_ZONE_TYPES.has(w.type),
    );

    if (grayZoneWorkouts.length > 1) {
      warnings.push(
        `Week ${week.weekNumber}: ${grayZoneWorkouts.length} moderate-intensity ("gray zone") sessions ` +
          `(${grayZoneWorkouts.map((w) => w.type).join(", ")}). ` +
          `Polarized training recommends at most 1 — prefer easy or hard sessions.`,
      );
    }
  }

  // ── 9. Recovery-informed hard session spacing ─────────────────────
  // Only when recovery is measurably compromised — "unknown" (no data) must
  // not be treated as fatigue.
  if (
    athleteContext?.recovery &&
    ["moderate", "fatigued", "depleted"].includes(athleteContext.recovery.status)
  ) {
    // When recovery is compromised, ensure minimum 48h between hard sessions
    for (const week of adjusted.weeks) {
      const sorted = [...week.workouts].sort(
        (a, b) => dayIndex(a.day) - dayIndex(b.day),
      );

      const hardDays = sorted
        .filter((w) => isHardWorkout(w.type))
        .map((w) => ({ day: dayIndex(w.day), type: w.type, dayName: w.day }));

      for (let i = 0; i < hardDays.length - 1; i++) {
        const gap = hardDays[i + 1].day - hardDays[i].day;
        if (gap < 2) {
          warnings.push(
            `Week ${week.weekNumber}: hard sessions on ${hardDays[i].dayName} and ${hardDays[i + 1].dayName} ` +
              `(${gap} day gap). Recovery is ${athleteContext.recovery.status} ` +
              `(${athleteContext.recovery.score}/100) — recommend 48h+ between hard sessions.`,
          );
        }
      }
    }
  }

  // ── 10. Structured health constraint enforcement ───────────────────
  if (healthConstraints && healthConstraints.length > 0) {
    const now = new Date().toISOString().slice(0, 10); // yyyy-MM-dd

    // Only active constraints
    const activeConstraints = healthConstraints.filter((c) => {
      if (c.activeFrom && c.activeFrom > now) return false;
      if (c.activeUntil && c.activeUntil < now) return false;
      return true;
    });

    for (const week of adjusted.weeks) {
      for (const workout of week.workouts) {
        for (const constraint of activeConstraints) {
          if (!constraint.affectedWorkoutTypes.includes(workout.type)) continue;

          if (constraint.severity === "avoid") {
            const originalType = workout.type;
            workout.type = "easy_run";
            workout.title = `Easy run (substituted from ${originalType} — ${constraint.label})`;
            warnings.push(
              `Week ${week.weekNumber} (${workout.day}): ${originalType} substituted with easy_run — constraint: "${constraint.label}" [${constraint.category}]`,
            );
            adjustments.push({
              weekNumber: week.weekNumber,
              rule: "health_constraint_avoid",
              description: `Substituted ${originalType} → easy_run (constraint: ${constraint.label})`,
              before: originalType,
              after: "easy_run",
            });
            violations.push({
              rule: "health_constraint_avoid",
              directive: `Week ${week.weekNumber} must not include ${originalType} — athlete has "${constraint.label}" constraint requiring avoidance of this workout type. Use easy_run or rest instead.`,
            });
          } else if (constraint.severity === "modify") {
            warnings.push(
              `Week ${week.weekNumber} (${workout.day}): ${workout.type} requires modification — constraint: "${constraint.label}" [${constraint.category}]. ${constraint.notes ?? "Reduce intensity or duration."}`,
            );
          }
        }
      }
    }
  }

  const valid = warnings.length === 0;

  return {
    valid,
    warnings,
    adjustments,
    violations,
    plan: adjusted,
  };
}
