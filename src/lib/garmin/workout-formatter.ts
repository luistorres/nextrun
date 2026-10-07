/**
 * Converts internal WorkoutStep[] format to Garmin WorkoutDTO format.
 *
 * Key unit conversions:
 * - Our pace targets are in seconds/km. Garmin Training API uses seconds/km as
 *   well for PACE targets (endConditionValue for distance is in meters, time
 *   is in seconds).
 * - Duration: our internal format stores time-based durations in seconds and
 *   distance-based durations in meters (matching the DB schema). These map
 *   directly to Garmin's endConditionValue.
 * - Pace targets: passed through as-is (seconds per km on both sides).
 *
 * IMPORTANT: Garmin pace target values use seconds/km where a LOWER number
 * means FASTER pace. targetValueLow is the faster (lower) bound and
 * targetValueHigh is the slower (higher) bound.
 */

import type { WorkoutStep, SimpleWorkoutStep, IntervalWorkoutStep, WorkoutType } from "@/types/plan";
import type {
  GarminWorkoutDTO,
  GarminWorkoutStep,
  GarminWorkoutStepDTO,
  GarminWorkoutRepeatGroupDTO,
  GarminStepType,
  GarminEndCondition,
  GarminTargetType,
} from "@/types/garmin";

// ─── Step Type Mapping ──────────────────────────────────────────────────────

function mapStepType(type: SimpleWorkoutStep["type"]): GarminStepType {
  switch (type) {
    case "warmup":
      return "WARMUP";
    case "cooldown":
      return "COOLDOWN";
    case "steady":
      return "ACTIVE";
    default: {
      const _exhaustive: never = type;
      throw new Error(`Unknown step type: ${_exhaustive}`);
    }
  }
}

function mapEndCondition(durationType: string): GarminEndCondition {
  switch (durationType) {
    case "time":
      return "TIME";
    case "distance":
      return "DISTANCE";
    case "open":
      return "OPEN";
    default:
      throw new Error(`Unknown duration type: ${durationType}`);
  }
}

function mapTargetType(targetType: string): GarminTargetType {
  switch (targetType) {
    case "pace":
      return "PACE";
    case "heart_rate":
      return "HEART_RATE";
    case "open":
      return "OPEN";
    default:
      throw new Error(`Unknown target type: ${targetType}`);
  }
}

// ─── Sport Type Mapping ─────────────────────────────────────────────────────

function mapWorkoutTypeToSport(
  workoutType: WorkoutType,
): GarminWorkoutDTO["sport"] {
  switch (workoutType) {
    case "easy_run":
    case "long_run":
    case "tempo":
    case "intervals":
    case "recovery":
    case "fartlek":
    case "hill_repeats":
    case "race_pace":
      return "RUNNING";
    case "cross_training":
      return "OTHER";
    case "rest":
      return "OTHER";
    default:
      return "RUNNING";
  }
}

// ─── Step Converters ────────────────────────────────────────────────────────

function convertSimpleStep(
  step: SimpleWorkoutStep,
  stepOrder: number,
): GarminWorkoutStepDTO {
  const garminStep: GarminWorkoutStepDTO = {
    type: "WorkoutStep",
    stepOrder,
    stepType: mapStepType(step.type),
    endCondition: mapEndCondition(step.durationType),
    targetType: mapTargetType(step.targetType),
  };

  // endConditionValue: seconds for TIME, meters for DISTANCE, omitted for OPEN
  if (step.durationType !== "open" && step.durationValue !== undefined) {
    garminStep.endConditionValue = step.durationValue;
  }

  // Pace targets: seconds/km (both internal and Garmin format)
  // HEART_RATE targets: bpm values
  if (step.targetType !== "open") {
    if (step.targetMin !== undefined) {
      garminStep.targetValueLow = step.targetMin;
    }
    if (step.targetMax !== undefined) {
      garminStep.targetValueHigh = step.targetMax;
    }
  }

  if (step.description) {
    garminStep.description = step.description;
  }

  return garminStep;
}

function convertIntervalStep(
  step: IntervalWorkoutStep,
  stepOrder: number,
): GarminWorkoutRepeatGroupDTO {
  const workGarminStep: GarminWorkoutStepDTO = {
    type: "WorkoutStep",
    stepOrder: 1,
    stepType: "ACTIVE",
    endCondition: mapEndCondition(step.workStep.durationType),
    targetType: mapTargetType(step.workStep.targetType),
  };

  if (
    step.workStep.durationType !== "open" &&
    step.workStep.durationValue !== undefined
  ) {
    workGarminStep.endConditionValue = step.workStep.durationValue;
  }

  if (step.workStep.targetType !== "open") {
    if (step.workStep.targetMin !== undefined) {
      workGarminStep.targetValueLow = step.workStep.targetMin;
    }
    if (step.workStep.targetMax !== undefined) {
      workGarminStep.targetValueHigh = step.workStep.targetMax;
    }
  }

  const restGarminStep: GarminWorkoutStepDTO = {
    type: "WorkoutStep",
    stepOrder: 2,
    stepType: "RECOVERY",
    endCondition: mapEndCondition(step.restStep.durationType),
    targetType: mapTargetType(step.restStep.targetType),
  };

  if (
    step.restStep.durationType !== "open" &&
    step.restStep.durationValue !== undefined
  ) {
    restGarminStep.endConditionValue = step.restStep.durationValue;
  }

  return {
    type: "WorkoutRepeatGroupDTO",
    stepOrder,
    numberOfIterations: step.repeatCount,
    steps: [workGarminStep, restGarminStep],
  };
}

// ─── Main Formatter ─────────────────────────────────────────────────────────

/**
 * Convert internal WorkoutStep[] to an array of Garmin-formatted steps.
 *
 * Steps are ordered by their `order` field, and the Garmin stepOrder is
 * assigned sequentially starting at 1.
 */
export function formatStepsForGarmin(
  steps: WorkoutStep[],
): GarminWorkoutStep[] {
  // Sort by order field to ensure correct sequencing
  const sorted = [...steps].sort((a, b) => a.order - b.order);

  return sorted.map((step, idx) => {
    const stepOrder = idx + 1;

    if (step.type === "interval") {
      return convertIntervalStep(step as IntervalWorkoutStep, stepOrder);
    }

    return convertSimpleStep(step as SimpleWorkoutStep, stepOrder);
  });
}

/**
 * Build a complete GarminWorkoutDTO from internal workout data.
 *
 * @param name - Workout title (e.g. "Tempo Run - 6km at 5:15/km")
 * @param description - Optional description
 * @param workoutType - Our internal WorkoutType enum value
 * @param steps - Internal WorkoutStep[] from the planned_workout
 * @param scheduledDate - Optional ISO date string (YYYY-MM-DD)
 */
export function buildGarminWorkout(
  name: string,
  description: string | undefined,
  workoutType: WorkoutType,
  steps: WorkoutStep[],
  scheduledDate?: string,
): GarminWorkoutDTO {
  const dto: GarminWorkoutDTO = {
    workoutName: name,
    sport: mapWorkoutTypeToSport(workoutType),
    steps: formatStepsForGarmin(steps),
  };

  if (description) {
    dto.description = description;
  }

  if (scheduledDate) {
    dto.scheduledDate = scheduledDate;
  }

  return dto;
}

// ─── Utility: Pace Conversion Helpers ───────────────────────────────────────

/**
 * Convert a pace string like "5:15" (min:sec per km) to seconds per km.
 * Useful for building workout steps from user-facing pace strings.
 */
export function paceStringToSecondsPerKm(pace: string): number {
  const [minutes, seconds] = pace.split(":").map(Number);
  return minutes * 60 + seconds;
}

/**
 * Convert seconds per km to a human-readable pace string (e.g. "5:15").
 */
export function secondsPerKmToPaceString(secondsPerKm: number): string {
  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = Math.round(secondsPerKm % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Convert km to meters.
 */
export function kmToMeters(km: number): number {
  return Math.round(km * 1000);
}

/**
 * Convert minutes to seconds.
 */
export function minutesToSeconds(minutes: number): number {
  return Math.round(minutes * 60);
}
