/**
 * Plan-generation eval assertion library.
 *
 * Given a parsed PlanGenerationOutput plus the generation context (goal,
 * schedule, experience), runs a battery of structural and training-science
 * assertions and returns a structured report. This is the verification layer
 * for any model / prompt / schema change: golden fixtures are checked in
 * eval.test.ts, and live model output can be checked via scripts/eval-plan.ts.
 *
 * The rules deliberately mirror the post-AI guardrails (guardrails.ts) where
 * they overlap — same hard-workout classification, same progression banding,
 * same taper evidence (Bosquet 2007) — but unlike guardrails they never
 * adjust the plan; they only judge it.
 */

import { planGenerationOutputSchema } from "@/lib/ai/output-parser";
import { taperWeeksForDistance } from "@/lib/plan-engine/periodization";
import type {
  PlanGenerationOutput,
  GeneratedWeek,
  GeneratedWorkout,
  WorkoutType,
} from "@/types/plan";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlanEvalContext {
  /** Goal race distance in meters (drives expected taper length) */
  goalDistanceMeters: number;
  /** Expected plan length in weeks */
  totalWeeks: number;
  /** Training days per week the athlete asked for */
  daysPerWeek: number;
  /** Preferred training days (lowercase day names) */
  preferredDays: string[];
  /** Preferred long run day (lowercase) */
  preferredLongRunDay: string;
  /** Experience level — drives progression band and minimum rest days */
  experienceLevel: "beginner" | "experienced";
  /** Current weekly mileage baseline (km). Falls back to week 1 if omitted. */
  currentWeeklyMileageKm?: number;
}

export interface AssertionResult {
  rule: string;
  pass: boolean;
  details: string;
}

export interface EvalReport {
  assertions: AssertionResult[];
  passCount: number;
  failCount: number;
  /** Human-readable multi-line summary of every assertion */
  summary: string;
}

// ---------------------------------------------------------------------------
// Shared classification (mirrors guardrails.ts)
// ---------------------------------------------------------------------------

const HARD_WORKOUT_TYPES: Set<WorkoutType> = new Set([
  "tempo",
  "intervals",
  "hill_repeats",
  "race_pace",
  "fartlek",
]);

const DAY_ORDER: Record<string, number> = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6,
};

/** Pace targets (sec/km) outside this range are nonsensical for running. */
const PACE_MIN_SECS_PER_KM = 150;
const PACE_MAX_SECS_PER_KM = 900;

/** No single workout or step should exceed this distance (meters). */
const MAX_WORKOUT_DISTANCE_METERS = 60_000;

/** Weekly mileage targets above this are not plausible for this product. */
const MAX_WEEKLY_MILEAGE_KM = 200;

/** Progression cap by experience (mirrors guardrails.ts). */
const PROGRESSION_CAP: Record<PlanEvalContext["experienceLevel"], number> = {
  beginner: 1.1,
  experienced: 1.2,
};

/** A non-taper week below 95% of the running baseline is a step-back week. */
const STEP_BACK_DETECTION_RATIO = 0.95;

/** Step-back weeks must reduce volume by 20-30% from the last normal week. */
const STEP_BACK_MIN_REDUCTION = 0.2;
const STEP_BACK_MAX_REDUCTION = 0.3;
/** Small tolerance so 19.9% / 30.1% rounding doesn't fail the band. */
const STEP_BACK_BAND_EPSILON = 0.005;

/** Max normal weeks between step-backs (and before the first one). */
const STEP_BACK_MAX_GAP = 5;
const STEP_BACK_MIN_GAP = 3;

/** Week after a step-back must return to >= 98% of pre-step-back volume. */
const SAWTOOTH_RECOVERY_RATIO = 0.98;

function isHardWorkout(type: WorkoutType): boolean {
  return HARD_WORKOUT_TYPES.has(type);
}

function isRunningWorkout(type: WorkoutType): boolean {
  return type !== "rest" && type !== "cross_training";
}

function isRestWorkout(type: WorkoutType): boolean {
  return type === "rest";
}

function dayIndex(day: string): number {
  return DAY_ORDER[day.toLowerCase()] ?? -1;
}

/**
 * Estimate workout distance in km (same heuristic as guardrails.ts:
 * prefer targetDistanceMeters, else sum steps, time at ~6:00/km).
 */
function estimateWorkoutDistanceKm(workout: GeneratedWorkout): number {
  if (workout.targetDistanceMeters) {
    return workout.targetDistanceMeters / 1000;
  }

  let totalMeters = 0;
  for (const step of workout.steps) {
    if (step.type === "interval") {
      const workDist =
        step.workStep.durationType === "distance"
          ? (step.workStep.durationValue ?? 0)
          : 0;
      const restDist =
        step.restStep.durationType === "distance"
          ? (step.restStep.durationValue ?? 0)
          : 0;
      totalMeters += (workDist + restDist) * step.repeatCount;
    } else if (step.durationType === "distance") {
      totalMeters += step.durationValue ?? 0;
    } else if (step.durationType === "time" && step.durationValue) {
      totalMeters += (step.durationValue / 360) * 1000;
    }
  }

  return totalMeters / 1000;
}

function isNormalPhaseWeek(week: GeneratedWeek): boolean {
  return week.phase !== "taper" && week.phase !== "race_week";
}

// ---------------------------------------------------------------------------
// Volume trajectory analysis (shared by progression / step-back / sawtooth)
// ---------------------------------------------------------------------------

interface StepBackInfo {
  week: GeneratedWeek;
  /** 1-based position within the sequence of non-taper weeks */
  position: number;
  /** Last normal week's mileage before this step-back */
  preStepBackKm: number;
  /** Reduction fraction vs the pre-step-back baseline (0.25 = 25%) */
  reduction: number;
  /** The next normal (non-step-back) week after this step-back, if any */
  nextNormalWeek: GeneratedWeek | null;
}

interface VolumeAnalysis {
  /** Non-taper, non-race weeks in plan order */
  normalPhaseWeeks: GeneratedWeek[];
  stepBacks: StepBackInfo[];
  /** Progression cap violations: formatted strings */
  capViolations: string[];
}

function analyzeVolumeTrajectory(
  plan: PlanGenerationOutput,
  context: PlanEvalContext,
): VolumeAnalysis {
  const cap = PROGRESSION_CAP[context.experienceLevel];
  const normalPhaseWeeks = plan.weeks.filter(isNormalPhaseWeek);

  const capViolations: string[] = [];
  const stepBacks: StepBackInfo[] = [];

  let baseline =
    context.currentWeeklyMileageKm ??
    normalPhaseWeeks[0]?.weeklyMileageTargetKm ??
    0;
  // When the baseline comes from week 1 itself, week 1 trivially passes the
  // cap; when it comes from the athlete's current mileage, week 1 is checked.
  let pendingStepBack: StepBackInfo | null = null;

  for (let i = 0; i < normalPhaseWeeks.length; i++) {
    const week = normalPhaseWeeks[i];
    const mileage = week.weeklyMileageTargetKm;

    const isStepBack = mileage < baseline * STEP_BACK_DETECTION_RATIO;

    if (isStepBack) {
      const info: StepBackInfo = {
        week,
        position: i + 1,
        preStepBackKm: baseline,
        reduction: baseline > 0 ? 1 - mileage / baseline : 0,
        nextNormalWeek: null,
      };
      stepBacks.push(info);
      // Track only the first step-back of a consecutive run for sawtooth.
      if (!pendingStepBack) pendingStepBack = info;
      continue; // baseline untouched — step-backs never lower the baseline
    }

    // Normal week: check the progression cap vs the last normal baseline.
    const maxAllowed = baseline * cap + 1e-9;
    if (mileage > maxAllowed) {
      capViolations.push(
        `week ${week.weekNumber}: ${mileage}km exceeds ${Math.round((cap - 1) * 100)}% cap (max ${(baseline * cap).toFixed(1)}km from last normal week's ${baseline.toFixed(1)}km)`,
      );
    }

    // First normal week after a step-back run → record it for sawtooth check.
    if (pendingStepBack) {
      pendingStepBack.nextNormalWeek = week;
      pendingStepBack = null;
    }

    baseline = mileage;
  }

  return { normalPhaseWeeks, stepBacks, capViolations };
}

// ---------------------------------------------------------------------------
// Individual assertions
// ---------------------------------------------------------------------------

function assertVolumeProgression(analysis: VolumeAnalysis, context: PlanEvalContext): AssertionResult {
  const capPercent = Math.round((PROGRESSION_CAP[context.experienceLevel] - 1) * 100);
  return {
    rule: "volume_progression",
    pass: analysis.capViolations.length === 0,
    details:
      analysis.capViolations.length === 0
        ? `all week-over-week increases within the ${capPercent}% ${context.experienceLevel} band vs last normal week`
        : analysis.capViolations.join("; "),
  };
}

function assertStepBackPresence(analysis: VolumeAnalysis): AssertionResult {
  const count = analysis.normalPhaseWeeks.length;
  const problems: string[] = [];

  // Plans whose non-taper block is shorter than the minimum cycle don't need
  // a step-back at all.
  if (count >= STEP_BACK_MAX_GAP + 1 && analysis.stepBacks.length === 0) {
    problems.push(
      `no step-back week found in ${count} non-taper weeks (expected one every ${STEP_BACK_MIN_GAP}-${STEP_BACK_MAX_GAP} weeks)`,
    );
  }

  // Spacing: start → first step-back, then between consecutive step-backs.
  let previousPosition = 0;
  for (const sb of analysis.stepBacks) {
    const gap = sb.position - previousPosition;
    if (gap < STEP_BACK_MIN_GAP || gap > STEP_BACK_MAX_GAP) {
      problems.push(
        `step-back at week ${sb.week.weekNumber} comes ${gap} week(s) after the previous cycle (expected ${STEP_BACK_MIN_GAP}-${STEP_BACK_MAX_GAP})`,
      );
    }
    previousPosition = sb.position;
  }

  // Trailing stretch before the taper must not exceed the max gap either.
  if (analysis.stepBacks.length > 0) {
    const trailing = count - previousPosition;
    if (trailing > STEP_BACK_MAX_GAP) {
      problems.push(
        `${trailing} normal weeks after the last step-back without recovery (max ${STEP_BACK_MAX_GAP})`,
      );
    }
  }

  // Magnitude: each step-back must cut 20-30% from the pre-step-back week.
  for (const sb of analysis.stepBacks) {
    const lo = STEP_BACK_MIN_REDUCTION - STEP_BACK_BAND_EPSILON;
    const hi = STEP_BACK_MAX_REDUCTION + STEP_BACK_BAND_EPSILON;
    if (sb.reduction < lo || sb.reduction > hi) {
      problems.push(
        `step-back week ${sb.week.weekNumber} reduces ${(sb.reduction * 100).toFixed(0)}% vs ${sb.preStepBackKm.toFixed(1)}km (expected 20-30%)`,
      );
    }
  }

  return {
    rule: "step_back_presence",
    pass: problems.length === 0,
    details:
      problems.length === 0
        ? analysis.stepBacks.length > 0
          ? `step-back weeks at ${analysis.stepBacks.map((s) => s.week.weekNumber).join(", ")} — spacing and 20-30% reductions OK`
          : "plan too short to require a step-back week"
        : problems.join("; "),
  };
}

function assertNoSawtooth(analysis: VolumeAnalysis): AssertionResult {
  const problems: string[] = [];

  for (const sb of analysis.stepBacks) {
    if (!sb.nextNormalWeek) continue; // taper follows — nothing to rebound to
    const rebound = sb.nextNormalWeek.weeklyMileageTargetKm;
    const required = sb.preStepBackKm * SAWTOOTH_RECOVERY_RATIO;
    if (rebound < required) {
      problems.push(
        `week ${sb.nextNormalWeek.weekNumber} only rebounds to ${rebound}km after the week-${sb.week.weekNumber} step-back (pre-step-back trajectory was ${sb.preStepBackKm.toFixed(1)}km)`,
      );
    }
  }

  return {
    rule: "no_sawtooth",
    pass: problems.length === 0,
    details:
      problems.length === 0
        ? "every post-step-back week returns to at least the pre-step-back trajectory"
        : problems.join("; "),
  };
}

function assertTaperShape(plan: PlanGenerationOutput): AssertionResult[] {
  const taperWeeks = plan.weeks.filter((w) => w.phase === "taper");
  const peakWeeks = plan.weeks.filter((w) => w.phase === "peak");

  if (taperWeeks.length === 0) {
    const fail: AssertionResult = {
      rule: "taper_volume",
      pass: false,
      details: "plan has no taper weeks",
    };
    return [
      fail,
      { ...fail, rule: "taper_intensity" },
    ];
  }

  // Reference volume: average of peak-phase weeks (Bosquet 2007 compares to
  // pre-taper training volume); fall back to the biggest non-taper week.
  const referenceKm =
    peakWeeks.length > 0
      ? peakWeeks.reduce((sum, w) => sum + w.weeklyMileageTargetKm, 0) / peakWeeks.length
      : Math.max(...plan.weeks.filter(isNormalPhaseWeek).map((w) => w.weeklyMileageTargetKm));

  const volumeProblems: string[] = [];
  for (let t = 0; t < taperWeeks.length; t++) {
    const week = taperWeeks[t];
    const isFinal = t === taperWeeks.length - 1;
    const reductionPct =
      ((referenceKm - week.weeklyMileageTargetKm) / referenceKm) * 100;

    if (isFinal) {
      // Final taper week: 41-60% below peak average volume.
      if (reductionPct < 40 || reductionPct > 60) {
        volumeProblems.push(
          `final taper week ${week.weekNumber} cuts ${reductionPct.toFixed(0)}% of peak volume (expected 41-60%)`,
        );
      }
    } else if (reductionPct < 20) {
      volumeProblems.push(
        `taper week ${week.weekNumber} cuts only ${reductionPct.toFixed(0)}% of peak volume (early taper weeks should cut >=20%)`,
      );
    }
  }

  const finalTaperWeek = taperWeeks[taperWeeks.length - 1];
  const hasQualityTouch = finalTaperWeek.workouts.some((w) => isHardWorkout(w.type));

  return [
    {
      rule: "taper_volume",
      pass: volumeProblems.length === 0,
      details:
        volumeProblems.length === 0
          ? `taper steps down from a ${referenceKm.toFixed(1)}km peak average to ${finalTaperWeek.weeklyMileageTargetKm}km in the final week`
          : volumeProblems.join("; "),
    },
    {
      rule: "taper_intensity",
      pass: hasQualityTouch,
      details: hasQualityTouch
        ? `final taper week ${finalTaperWeek.weekNumber} keeps a quality touch (${finalTaperWeek.workouts
            .filter((w) => isHardWorkout(w.type))
            .map((w) => w.type)
            .join(", ")})`
        : `final taper week ${finalTaperWeek.weekNumber} has no quality session — taper should cut volume, not intensity`,
    },
  ];
}

function assertTaperLength(plan: PlanGenerationOutput, context: PlanEvalContext): AssertionResult {
  const expected = taperWeeksForDistance(context.goalDistanceMeters, context.totalWeeks);
  const actual = plan.weeks.filter((w) => w.phase === "taper").length;

  return {
    rule: "taper_length",
    pass: actual === expected,
    details:
      actual === expected
        ? `${actual} taper week(s) — matches taperWeeksForDistance for ${(context.goalDistanceMeters / 1000).toFixed(1)}km`
        : `${actual} taper week(s), expected ${expected} for a ${(context.goalDistanceMeters / 1000).toFixed(1)}km goal over ${context.totalWeeks} weeks`,
  };
}

function assertEasyVolumeDistribution(plan: PlanGenerationOutput): AssertionResult {
  const problems: string[] = [];

  for (const week of plan.weeks) {
    if (week.phase === "race_week") continue;

    const runWorkouts = week.workouts.filter((w) => isRunningWorkout(w.type));
    if (runWorkouts.length === 0) continue;

    const totalKm = runWorkouts.reduce((sum, w) => sum + estimateWorkoutDistanceKm(w), 0);
    if (totalKm <= 0) continue;

    const easyKm = runWorkouts
      .filter((w) => !isHardWorkout(w.type))
      .reduce((sum, w) => sum + estimateWorkoutDistanceKm(w), 0);

    const easyPercent = (easyKm / totalKm) * 100;
    if (easyPercent < 70) {
      problems.push(
        `week ${week.weekNumber}: easy volume only ${easyPercent.toFixed(0)}% (need >=70%, target ~80%)`,
      );
    }
  }

  return {
    rule: "easy_volume_80_20",
    pass: problems.length === 0,
    details:
      problems.length === 0
        ? "every non-race week keeps easy volume >= 70% (80/20 intensity distribution)"
        : problems.join("; "),
  };
}

function assertScheduleCompliance(plan: PlanGenerationOutput, context: PlanEvalContext): AssertionResult[] {
  const preferred = new Set(context.preferredDays.map((d) => d.toLowerCase()));
  const longRunDay = context.preferredLongRunDay.toLowerCase();
  const minRestDays = context.experienceLevel === "beginner" ? 2 : 1;

  const dayCountProblems: string[] = [];
  const preferredDayProblems: string[] = [];
  const longRunProblems: string[] = [];
  const consecutiveHardProblems: string[] = [];
  const restDayProblems: string[] = [];

  for (const week of plan.weeks) {
    const trainingWorkouts = week.workouts.filter((w) => !isRestWorkout(w.type));

    // Exactly daysPerWeek non-rest workouts.
    if (trainingWorkouts.length !== context.daysPerWeek) {
      dayCountProblems.push(
        `week ${week.weekNumber}: ${trainingWorkouts.length} training day(s), expected ${context.daysPerWeek}`,
      );
    }

    // No duplicate days, all training on preferred days.
    const seenDays = new Set<string>();
    for (const workout of week.workouts) {
      const day = workout.day.toLowerCase();
      if (seenDays.has(day)) {
        dayCountProblems.push(`week ${week.weekNumber}: duplicate workouts on ${day}`);
      }
      seenDays.add(day);
    }
    for (const workout of trainingWorkouts) {
      if (!preferred.has(workout.day.toLowerCase())) {
        preferredDayProblems.push(
          `week ${week.weekNumber}: ${workout.type} scheduled on ${workout.day} (not a preferred day)`,
        );
      }
    }

    // Long run placement.
    for (const workout of week.workouts) {
      if (workout.type === "long_run" && workout.day.toLowerCase() !== longRunDay) {
        longRunProblems.push(
          `week ${week.weekNumber}: long run on ${workout.day}, expected ${longRunDay}`,
        );
      }
    }

    // No consecutive hard days (mirrors guardrail rule 4).
    const sorted = [...week.workouts].sort((a, b) => dayIndex(a.day) - dayIndex(b.day));
    for (let i = 0; i < sorted.length - 1; i++) {
      if (
        dayIndex(sorted[i + 1].day) - dayIndex(sorted[i].day) === 1 &&
        isHardWorkout(sorted[i].type) &&
        isHardWorkout(sorted[i + 1].type)
      ) {
        consecutiveHardProblems.push(
          `week ${week.weekNumber}: ${sorted[i].type} (${sorted[i].day}) followed by ${sorted[i + 1].type} (${sorted[i + 1].day})`,
        );
      }
    }

    // Minimum rest days, counted as days with no training workout.
    const restDays = 7 - trainingWorkouts.length;
    if (restDays < minRestDays) {
      restDayProblems.push(
        `week ${week.weekNumber}: only ${restDays} rest day(s), minimum ${minRestDays} for ${context.experienceLevel}`,
      );
    }
  }

  const result = (rule: string, problems: string[], okDetails: string): AssertionResult => ({
    rule,
    pass: problems.length === 0,
    details: problems.length === 0 ? okDetails : problems.join("; "),
  });

  return [
    result(
      "days_per_week",
      dayCountProblems,
      `every week has exactly ${context.daysPerWeek} training days`,
    ),
    result(
      "preferred_days",
      preferredDayProblems,
      `all training days fall on [${context.preferredDays.join(", ")}]`,
    ),
    result("long_run_day", longRunProblems, `all long runs on ${longRunDay}`),
    result(
      "no_consecutive_hard_days",
      consecutiveHardProblems,
      "no back-to-back hard sessions",
    ),
    result(
      "min_rest_days",
      restDayProblems,
      `every week keeps >= ${minRestDays} rest day(s)`,
    ),
  ];
}

function assertStructure(plan: PlanGenerationOutput, context: PlanEvalContext): AssertionResult[] {
  const results: AssertionResult[] = [];

  // totalWeeks matches the requested horizon and the weeks array.
  const totalWeeksOk =
    plan.totalWeeks === context.totalWeeks && plan.weeks.length === plan.totalWeeks;
  results.push({
    rule: "total_weeks",
    pass: totalWeeksOk,
    details: totalWeeksOk
      ? `totalWeeks=${plan.totalWeeks} matches the requested horizon and weeks array`
      : `totalWeeks=${plan.totalWeeks}, weeks array length=${plan.weeks.length}, requested=${context.totalWeeks}`,
  });

  // Weeks numbered consecutively from 1.
  const numberingProblems = plan.weeks
    .map((w, i) => ({ w, expected: i + 1 }))
    .filter(({ w, expected }) => w.weekNumber !== expected)
    .map(({ w, expected }) => `index ${expected} has weekNumber ${w.weekNumber}`);
  results.push({
    rule: "week_numbering",
    pass: numberingProblems.length === 0,
    details:
      numberingProblems.length === 0
        ? `weeks numbered 1..${plan.weeks.length} consecutively`
        : numberingProblems.join("; "),
  });

  // Phases contiguous, ordered base -> build -> peak -> taper (-> race_week),
  // covering all weeks; each week's phase matches its boundary.
  const phaseOrder: Record<string, number> = {
    base: 0,
    build: 1,
    peak: 2,
    taper: 3,
    race_week: 4,
  };
  const phaseProblems: string[] = [];
  const boundaries = [...plan.phases].sort((a, b) => a.startWeek - b.startWeek);

  if (boundaries.length === 0) {
    phaseProblems.push("no phase boundaries defined");
  } else {
    if (boundaries[0].startWeek !== 1) {
      phaseProblems.push(`first phase starts at week ${boundaries[0].startWeek}, expected 1`);
    }
    if (boundaries[boundaries.length - 1].endWeek !== plan.totalWeeks) {
      phaseProblems.push(
        `last phase ends at week ${boundaries[boundaries.length - 1].endWeek}, expected ${plan.totalWeeks}`,
      );
    }
    for (let i = 1; i < boundaries.length; i++) {
      if (boundaries[i].startWeek !== boundaries[i - 1].endWeek + 1) {
        phaseProblems.push(
          `gap/overlap between ${boundaries[i - 1].phase} (ends ${boundaries[i - 1].endWeek}) and ${boundaries[i].phase} (starts ${boundaries[i].startWeek})`,
        );
      }
      if (phaseOrder[boundaries[i].phase] <= phaseOrder[boundaries[i - 1].phase]) {
        phaseProblems.push(
          `phase order violation: ${boundaries[i - 1].phase} -> ${boundaries[i].phase}`,
        );
      }
    }
    for (const week of plan.weeks) {
      const boundary = boundaries.find(
        (b) => week.weekNumber >= b.startWeek && week.weekNumber <= b.endWeek,
      );
      if (!boundary) {
        phaseProblems.push(`week ${week.weekNumber} not covered by any phase boundary`);
      } else if (boundary.phase !== week.phase) {
        phaseProblems.push(
          `week ${week.weekNumber} tagged ${week.phase} but falls in the ${boundary.phase} boundary`,
        );
      }
    }
  }
  results.push({
    rule: "phase_coverage",
    pass: phaseProblems.length === 0,
    details:
      phaseProblems.length === 0
        ? `phases [${boundaries.map((b) => b.phase).join(" -> ")}] cover weeks 1-${plan.totalWeeks} in order`
        : phaseProblems.join("; "),
  });

  // Full Zod validation — every workout/step parses against the schema.
  const zodResult = planGenerationOutputSchema.safeParse(plan);
  results.push({
    rule: "schema_valid",
    pass: zodResult.success,
    details: zodResult.success
      ? "plan parses against planGenerationOutputSchema"
      : zodResult.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
  });

  // Pace sanity: every pace target within 150-900 sec/km and min <= max.
  const paceProblems: string[] = [];
  const checkPace = (where: string, min?: number, max?: number) => {
    for (const [label, value] of [
      ["targetMin", min],
      ["targetMax", max],
    ] as const) {
      if (
        value != null &&
        (value < PACE_MIN_SECS_PER_KM || value > PACE_MAX_SECS_PER_KM)
      ) {
        paceProblems.push(`${where}: ${label}=${value} sec/km outside ${PACE_MIN_SECS_PER_KM}-${PACE_MAX_SECS_PER_KM}`);
      }
    }
    if (min != null && max != null && min > max) {
      paceProblems.push(`${where}: targetMin ${min} > targetMax ${max}`);
    }
  };

  // Distance sanity: workout / step distances and weekly mileage in range.
  const distanceProblems: string[] = [];
  const checkDistance = (where: string, meters?: number) => {
    if (meters != null && (meters <= 0 || meters > MAX_WORKOUT_DISTANCE_METERS)) {
      distanceProblems.push(`${where}: ${meters}m outside (0, ${MAX_WORKOUT_DISTANCE_METERS}]`);
    }
  };

  for (const week of plan.weeks) {
    if (
      week.weeklyMileageTargetKm <= 0 ||
      week.weeklyMileageTargetKm > MAX_WEEKLY_MILEAGE_KM
    ) {
      distanceProblems.push(
        `week ${week.weekNumber}: weeklyMileageTargetKm ${week.weeklyMileageTargetKm} outside (0, ${MAX_WEEKLY_MILEAGE_KM}]`,
      );
    }

    for (const workout of week.workouts) {
      const where = `week ${week.weekNumber} ${workout.day} ${workout.type}`;
      checkDistance(where, workout.targetDistanceMeters);

      for (const step of workout.steps) {
        if (step.type === "interval") {
          if (step.workStep.targetType === "pace") {
            checkPace(`${where} (work step)`, step.workStep.targetMin, step.workStep.targetMax);
          }
          if (step.workStep.durationType === "distance") {
            checkDistance(`${where} (work step)`, step.workStep.durationValue);
          }
          if (step.restStep.durationType === "distance") {
            checkDistance(`${where} (rest step)`, step.restStep.durationValue);
          }
        } else {
          if (step.targetType === "pace") {
            checkPace(`${where} (step ${step.order})`, step.targetMin, step.targetMax);
          }
          if (step.durationType === "distance") {
            checkDistance(`${where} (step ${step.order})`, step.durationValue);
          }
        }
      }
    }
  }

  results.push({
    rule: "pace_bounds",
    pass: paceProblems.length === 0,
    details:
      paceProblems.length === 0
        ? `all pace targets within ${PACE_MIN_SECS_PER_KM}-${PACE_MAX_SECS_PER_KM} sec/km`
        : paceProblems.slice(0, 5).join("; "),
  });
  results.push({
    rule: "distance_bounds",
    pass: distanceProblems.length === 0,
    details:
      distanceProblems.length === 0
        ? "all workout/step distances and weekly mileage targets in sane ranges"
        : distanceProblems.slice(0, 5).join("; "),
  });

  return results;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Run the full assertion battery against a parsed plan.
 */
export function evaluatePlan(
  plan: PlanGenerationOutput,
  context: PlanEvalContext,
): EvalReport {
  const volume = analyzeVolumeTrajectory(plan, context);

  const assertions: AssertionResult[] = [
    assertVolumeProgression(volume, context),
    assertStepBackPresence(volume),
    assertNoSawtooth(volume),
    ...assertTaperShape(plan),
    assertTaperLength(plan, context),
    assertEasyVolumeDistribution(plan),
    ...assertScheduleCompliance(plan, context),
    ...assertStructure(plan, context),
  ];

  const passCount = assertions.filter((a) => a.pass).length;
  const failCount = assertions.length - passCount;

  const lines = [
    `Plan eval: ${passCount}/${assertions.length} assertions passed${failCount > 0 ? `, ${failCount} FAILED` : ""}`,
    ...assertions.map((a) => `  ${a.pass ? "PASS" : "FAIL"} ${a.rule} — ${a.details}`),
  ];

  return { assertions, passCount, failCount, summary: lines.join("\n") };
}

/** Convenience: the rules that failed, by name. */
export function failedRules(report: EvalReport): string[] {
  return report.assertions.filter((a) => !a.pass).map((a) => a.rule);
}
