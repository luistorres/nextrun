/**
 * Garmin API type definitions.
 * Stubs for webhook payloads and Training API DTOs.
 * Refined in Units 05 and 07 with actual Garmin API schemas.
 */

// ─── Webhook Payload Types ──────────────────────────────────────────────────

export interface GarminWebhookPayload<T = unknown> {
  /** Array of records, potentially for multiple users */
  [key: string]: T[];
}

export interface GarminDailySummary {
  userAccessToken: string;
  summaryId: string;
  calendarDate: string;
  startTimeInSeconds: number;
  startTimeOffsetInSeconds: number;
  durationInSeconds: number;
  steps: number;
  distanceInMeters: number;
  activeTimeInSeconds: number;
  restingHeartRateInBeatsPerMinute: number;
  minHeartRateInBeatsPerMinute: number;
  maxHeartRateInBeatsPerMinute: number;
  averageStressLevel: number;
  maxStressLevel: number;
  bodyBatteryMostRecentValue: number;
  bodyBatteryHighestValue: number;
  bodyBatteryLowestValue: number;
  floorsClimbed: number;
  vo2Max: number;
  averageRespirationValue: number;
}

export interface GarminActivity {
  userAccessToken: string;
  activityId: number;
  activityName: string;
  activityType: string;
  startTimeInSeconds: number;
  startTimeOffsetInSeconds: number;
  durationInSeconds: number;
  distanceInMeters: number;
  averageHeartRateInBeatsPerMinute: number;
  maxHeartRateInBeatsPerMinute: number;
  averageSpeedInMetersPerSecond: number;
  elevationGainInMeters: number;
  activeKilocalories: number;
  deviceName: string;
  trainingEffectLabel?: string;
  activityTrainingLoad?: number;
  aerobicTrainingEffect?: number;
  anaerobicTrainingEffect?: number;
  vo2MaxValue?: number;
  /** Running cadence — standard Activity API summary fields */
  averageRunCadenceInStepsPerMinute?: number;
  maxRunCadenceInStepsPerMinute?: number;
  steps?: number;
}

export interface GarminSleep {
  userAccessToken: string;
  summaryId: string;
  calendarDate: string;
  startTimeInSeconds: number;
  durationInSeconds: number;
  deepSleepDurationInSeconds: number;
  lightSleepDurationInSeconds: number;
  remSleepInSeconds: number;
  awakeDurationInSeconds: number;
  sleepScores?: {
    overall?: { value: number };
    qualityScore?: number;
  };
}

export interface GarminStress {
  userAccessToken: string;
  summaryId: string;
  calendarDate: string;
  startTimeInSeconds: number;
  durationInSeconds: number;
  overallStressLevel: number;
  restStressDurationInSeconds: number;
  activityStressDurationInSeconds: number;
  highStressDurationInSeconds: number;
  lowStressDurationInSeconds: number;
  mediumStressDurationInSeconds: number;
  stressValuesArray?: number[][];
}

export interface GarminHRV {
  userAccessToken: string;
  summaryId: string;
  calendarDate: string;
  weeklyAvg: number;
  lastNight: number;
  lastNightAvg: number;
  lastNight5MinHigh: number;
  status: "BALANCED" | "LOW" | "HIGH" | "UNKNOWN";
  startTimestampGMT?: number;
  endTimestampGMT?: number;
}

export interface GarminBodyComposition {
  userAccessToken: string;
  summaryId: string;
  calendarDate: string;
  weightInGrams?: number;
  bodyFatPercentage?: number;
  bmi?: number;
  muscleMassInGrams?: number;
}

export interface GarminUserMetrics {
  userAccessToken: string;
  summaryId: string;
  calendarDate: string;
  vo2Max?: number;
  fitnessAge?: number;
}

export interface GarminDeregistration {
  userAccessToken: string;
  userRegistrationNumber: number;
}

// ─── Training API Types (for pushing workouts) ──────────────────────────────

export type GarminStepType =
  | "WARMUP"
  | "ACTIVE"
  | "RECOVERY"
  | "COOLDOWN"
  | "REST";
export type GarminEndCondition = "TIME" | "DISTANCE" | "OPEN";
export type GarminTargetType = "PACE" | "HEART_RATE" | "OPEN";

export interface GarminWorkoutStepDTO {
  type: "WorkoutStep";
  stepOrder: number;
  stepType: GarminStepType;
  endCondition: GarminEndCondition;
  endConditionValue?: number;
  targetType: GarminTargetType;
  targetValueLow?: number;
  targetValueHigh?: number;
  description?: string;
}

export interface GarminWorkoutRepeatGroupDTO {
  type: "WorkoutRepeatGroupDTO";
  stepOrder: number;
  numberOfIterations: number;
  steps: GarminWorkoutStepDTO[];
}

export type GarminWorkoutStep =
  | GarminWorkoutStepDTO
  | GarminWorkoutRepeatGroupDTO;

export interface GarminWorkoutDTO {
  workoutName: string;
  description?: string;
  sport: "RUNNING" | "CYCLING" | "SWIMMING" | "OTHER";
  steps: GarminWorkoutStep[];
  scheduledDate?: string;
}
