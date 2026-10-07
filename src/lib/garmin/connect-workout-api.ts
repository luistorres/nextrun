/**
 * Workout CRUD via the Garmin Connect web API (connectapi.garmin.com).
 *
 * Used when the user authenticated through the credential login flow
 * (garmin-connect library). The official Training API at apis.garmin.com
 * requires partner-level OAuth credentials and is handled separately
 * in training-api.ts.
 */

import { GarminConnect } from "garmin-connect";
import type {
  IOauth1Token,
  IOauth2Token,
} from "garmin-connect/dist/garmin/types";
import type {
  GarminWorkoutDTO,
  GarminWorkoutStep,
  GarminWorkoutStepDTO,
  GarminWorkoutRepeatGroupDTO,
} from "@/types/garmin";

// ─── Types ──────────────────────────────────────────────────────────────────

interface StoredTokens {
  oauth1: IOauth1Token;
  oauth2: IOauth2Token;
}

/** Garmin Connect workout-service step format */
interface ConnectStep {
  type: "ExecutableStepDTO";
  stepId: null;
  stepOrder: number;
  childStepId: null;
  description: string | null;
  stepType: { stepTypeId: number; stepTypeKey: string };
  endCondition: { conditionTypeId: number; conditionTypeKey: string };
  preferredEndConditionUnit: null;
  endConditionValue: number | null;
  endConditionCompare: null;
  endConditionZone: null;
  targetType: { workoutTargetTypeId: number; workoutTargetTypeKey: string };
  targetValueOne: number | null;
  targetValueTwo: number | null;
  zoneNumber: null;
}

interface ConnectRepeatGroup {
  type: "RepeatGroupDTO";
  stepOrder: number;
  numberOfIterations: number;
  smartRepeat: false;
  childStepId: null;
  workoutSteps: ConnectStep[];
}

type ConnectWorkoutStep = ConnectStep | ConnectRepeatGroup;

interface ConnectWorkoutPayload {
  sportType: { sportTypeId: number; sportTypeKey: string };
  workoutName: string;
  description?: string;
  workoutSegments: Array<{
    segmentOrder: number;
    sportType: { sportTypeId: number; sportTypeKey: string };
    workoutSteps: ConnectWorkoutStep[];
  }>;
}

// ─── Lookup Tables ──────────────────────────────────────────────────────────

const STEP_TYPE_MAP: Record<string, { stepTypeId: number; stepTypeKey: string }> = {
  WARMUP: { stepTypeId: 1, stepTypeKey: "warmup" },
  COOLDOWN: { stepTypeId: 2, stepTypeKey: "cooldown" },
  ACTIVE: { stepTypeId: 3, stepTypeKey: "interval" },
  RECOVERY: { stepTypeId: 4, stepTypeKey: "recovery" },
  REST: { stepTypeId: 5, stepTypeKey: "rest" },
};

const END_CONDITION_MAP: Record<string, { conditionTypeId: number; conditionTypeKey: string }> = {
  TIME: { conditionTypeId: 2, conditionTypeKey: "time" },
  DISTANCE: { conditionTypeId: 3, conditionTypeKey: "distance" },
  OPEN: { conditionTypeId: 1, conditionTypeKey: "lap.button" },
};

const TARGET_TYPE_MAP: Record<string, { workoutTargetTypeId: number; workoutTargetTypeKey: string }> = {
  PACE: { workoutTargetTypeId: 6, workoutTargetTypeKey: "pace.zone" },
  HEART_RATE: { workoutTargetTypeId: 4, workoutTargetTypeKey: "heart.rate.zone" },
  OPEN: { workoutTargetTypeId: 1, workoutTargetTypeKey: "no.target" },
};

const SPORT_MAP: Record<string, { sportTypeId: number; sportTypeKey: string }> = {
  RUNNING: { sportTypeId: 1, sportTypeKey: "running" },
  CYCLING: { sportTypeId: 2, sportTypeKey: "cycling" },
  SWIMMING: { sportTypeId: 5, sportTypeKey: "swimming" },
  OTHER: { sportTypeId: 4, sportTypeKey: "other" },
};

// ─── Format Conversion ─────────────────────────────────────────────────────

function convertStep(step: GarminWorkoutStepDTO, order: number): ConnectStep {
  // Garmin Connect API expects pace targets in m/s, but our internal format
  // stores them as seconds/km. Convert and swap: lower sec/km (faster) becomes
  // higher m/s, and vice versa.
  let targetValueOne: number | null = step.targetValueLow ?? null;
  let targetValueTwo: number | null = step.targetValueHigh ?? null;

  if (step.targetType === "PACE") {
    // sec/km → m/s, and swap so One < Two (slower m/s < faster m/s)
    targetValueOne =
      step.targetValueHigh != null ? 1000 / step.targetValueHigh : null;
    targetValueTwo =
      step.targetValueLow != null ? 1000 / step.targetValueLow : null;
  }

  return {
    type: "ExecutableStepDTO",
    stepId: null,
    stepOrder: order,
    childStepId: null,
    description: step.description ?? null,
    stepType: STEP_TYPE_MAP[step.stepType] ?? STEP_TYPE_MAP.ACTIVE,
    endCondition: END_CONDITION_MAP[step.endCondition] ?? END_CONDITION_MAP.OPEN,
    preferredEndConditionUnit: null,
    endConditionValue: step.endConditionValue ?? null,
    endConditionCompare: null,
    endConditionZone: null,
    targetType: TARGET_TYPE_MAP[step.targetType] ?? TARGET_TYPE_MAP.OPEN,
    targetValueOne,
    targetValueTwo,
    zoneNumber: null,
  };
}

function convertRepeatGroup(
  group: GarminWorkoutRepeatGroupDTO,
  order: number,
): ConnectRepeatGroup {
  return {
    type: "RepeatGroupDTO",
    stepOrder: order,
    numberOfIterations: group.numberOfIterations,
    smartRepeat: false,
    childStepId: null,
    workoutSteps: group.steps.map((s, i) => convertStep(s, i + 1)),
  };
}

function convertWorkout(dto: GarminWorkoutDTO): ConnectWorkoutPayload {
  const sport = SPORT_MAP[dto.sport] ?? SPORT_MAP.RUNNING;

  const steps: ConnectWorkoutStep[] = dto.steps.map(
    (step: GarminWorkoutStep, i: number) => {
      if (step.type === "WorkoutRepeatGroupDTO") {
        return convertRepeatGroup(step as GarminWorkoutRepeatGroupDTO, i + 1);
      }
      return convertStep(step as GarminWorkoutStepDTO, i + 1);
    },
  );

  const payload: ConnectWorkoutPayload = {
    sportType: sport,
    workoutName: dto.workoutName,
    workoutSegments: [
      {
        segmentOrder: 1,
        sportType: sport,
        workoutSteps: steps,
      },
    ],
  };

  if (dto.description) {
    payload.description = dto.description;
  }

  return payload;
}

// ─── Client Factory ─────────────────────────────────────────────────────────

function buildClient(tokenData: string): GarminConnect {
  const { oauth1, oauth2 } = JSON.parse(tokenData) as StoredTokens;
  const gc = new GarminConnect({ username: "", password: "" });
  gc.loadToken(oauth1, oauth2);
  return gc;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Create a workout and schedule it via the Garmin Connect web API.
 * Returns the Garmin-assigned workout ID.
 */
export async function createAndScheduleWorkoutViaConnect(
  tokenData: string,
  workout: GarminWorkoutDTO,
  date: string,
): Promise<string> {
  const gc = buildClient(tokenData);
  const connectPayload = convertWorkout(workout);

  // Create workout via garmin-connect library
  const created = await gc.addWorkout(connectPayload as never);
  const workoutId = String(created.workoutId);

  // Schedule to the user's calendar
  const scheduleUrl = `https://connectapi.garmin.com/workout-service/schedule/${workoutId}`;
  await gc.client.post(scheduleUrl, { date });

  return workoutId;
}

/**
 * Delete a workout via the Garmin Connect web API.
 */
export async function deleteWorkoutViaConnect(
  tokenData: string,
  garminWorkoutId: string,
): Promise<void> {
  const gc = buildClient(tokenData);
  await gc.deleteWorkout({ workoutId: garminWorkoutId });
}
