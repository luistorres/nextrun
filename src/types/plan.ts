/**
 * Training plan type definitions.
 */

// ─── Enums ──────────────────────────────────────────────────────────────────

export type WorkoutType =
  | "easy_run"
  | "long_run"
  | "tempo"
  | "intervals"
  | "recovery"
  | "fartlek"
  | "hill_repeats"
  | "race_pace"
  | "rest"
  | "cross_training";

export type PlanPhase = "base" | "build" | "peak" | "taper" | "race_week";

export type GoalType = "race" | "general_fitness" | "distance_milestone";

export type AdaptationTrigger =
  | "weekly_review"
  | "missed_workout"
  | "unplanned_activity"
  | "poor_recovery"
  | "user_request";

// ─── Workout Steps (internal format) ────────────────────────────────────────

export type StepDurationType = "time" | "distance" | "open";
export type StepTargetType = "pace" | "heart_rate" | "open";

export interface WorkoutStepBase {
  order: number;
  type: "warmup" | "cooldown" | "steady" | "interval";
  description?: string;
}

export interface SimpleWorkoutStep extends WorkoutStepBase {
  type: "warmup" | "cooldown" | "steady";
  durationType: StepDurationType;
  durationValue?: number;
  targetType: StepTargetType;
  targetMin?: number;
  targetMax?: number;
}

export interface IntervalWorkoutStep extends WorkoutStepBase {
  type: "interval";
  repeatCount: number;
  workStep: {
    durationType: StepDurationType;
    durationValue?: number;
    targetType: StepTargetType;
    targetMin?: number;
    targetMax?: number;
  };
  restStep: {
    durationType: StepDurationType;
    durationValue?: number;
    targetType: StepTargetType;
  };
}

export type WorkoutStep = SimpleWorkoutStep | IntervalWorkoutStep;

// ─── AI Input/Output ────────────────────────────────────────────────────────

export interface PlanGenerationInput {
  goal: {
    type: GoalType;
    raceName?: string;
    raceDate?: string;
    targetDistanceMeters: number;
    targetTimeSeconds?: number;
    weeksRemaining: number;
  };
  schedule: {
    daysPerWeek: number;
    preferredDays: string[];
    preferredLongRunDay: string;
  };
  currentMetrics?: {
    vo2Max?: number;
    restingHR?: number;
    hrvWeeklyAvg?: number;
    avgSleepScore?: number;
    avgStress?: number;
    recentPaces?: { distance: string; pace: number }[];
  };
  constraints?: string;
}

export interface PlanGenerationOutput {
  totalWeeks: number;
  phases: {
    phase: PlanPhase;
    startWeek: number;
    endWeek: number;
  }[];
  weeks: GeneratedWeek[];
}

export interface GeneratedWeek {
  weekNumber: number;
  phase: PlanPhase;
  weeklyMileageTargetKm: number;
  explanation?: string;
  workouts: GeneratedWorkout[];
}

export interface GeneratedWorkout {
  day: string;
  type: WorkoutType;
  title: string;
  description: string;
  targetDistanceMeters?: number;
  targetDurationSeconds?: number;
  steps: WorkoutStep[];
}

// ─── Adaptation ─────────────────────────────────────────────────────────────

export interface AdaptationChange {
  workoutId: string;
  change: "replaced" | "modified" | "added" | "removed" | "rescheduled";
  from?: string;
  to?: string;
  reason: string;
}

export interface AdaptationExplanation {
  summary: string;
  context: string;
  keyPoints: string[];
  outlook?: string;
}

export interface AdaptationOutput {
  needed: boolean;
  explanation: AdaptationExplanation;
  changes: AdaptationChange[];
  updatedWorkouts?: GeneratedWorkout[];
}
