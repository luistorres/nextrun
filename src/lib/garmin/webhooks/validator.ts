/**
 * Zod schemas for validating incoming Garmin webhook payloads.
 *
 * Validation is lenient on individual fields (many are optional in Garmin
 * payloads depending on device model), but strict on structural shape.
 * Validation errors are logged but never cause a crash — Garmin will not retry.
 */

import { z } from "zod";

// ─── Shared ────────────────────────────────────────────────────────────────

/** Every Garmin webhook item contains a userAccessToken. */
const baseItemSchema = z.object({
  userAccessToken: z.string(),
});

// ─── Daily Summary ─────────────────────────────────────────────────────────

export const dailySummaryItemSchema = baseItemSchema.extend({
  summaryId: z.string(),
  calendarDate: z.string(),
  startTimeInSeconds: z.number().optional(),
  startTimeOffsetInSeconds: z.number().optional(),
  durationInSeconds: z.number().optional(),
  steps: z.number().optional(),
  distanceInMeters: z.number().optional(),
  activeTimeInSeconds: z.number().optional(),
  restingHeartRateInBeatsPerMinute: z.number().optional(),
  minHeartRateInBeatsPerMinute: z.number().optional(),
  maxHeartRateInBeatsPerMinute: z.number().optional(),
  averageStressLevel: z.number().optional(),
  maxStressLevel: z.number().optional(),
  bodyBatteryMostRecentValue: z.number().optional(),
  bodyBatteryHighestValue: z.number().optional(),
  bodyBatteryLowestValue: z.number().optional(),
  floorsClimbed: z.number().optional(),
  vo2Max: z.number().optional(),
  averageRespirationValue: z.number().optional(),
});

export const dailySummaryPayloadSchema = z.object({
  dailies: z.array(dailySummaryItemSchema),
});

// ─── Activity ──────────────────────────────────────────────────────────────

export const activityItemSchema = baseItemSchema
  .extend({
    activityId: z.number(),
    activityName: z.string().optional(),
    activityType: z.string(),
    startTimeInSeconds: z.number(),
    startTimeOffsetInSeconds: z.number().optional(),
    durationInSeconds: z.number(),
    distanceInMeters: z.number().optional(),
    averageHeartRateInBeatsPerMinute: z.number().optional(),
    maxHeartRateInBeatsPerMinute: z.number().optional(),
    averageSpeedInMetersPerSecond: z.number().optional(),
    elevationGainInMeters: z.number().optional(),
    activeKilocalories: z.number().optional(),
    deviceName: z.string().optional(),
    trainingEffectLabel: z.string().optional(),
    activityTrainingLoad: z.number().optional(),
    aerobicTrainingEffect: z.number().optional(),
    anaerobicTrainingEffect: z.number().optional(),
    vo2MaxValue: z.number().optional(),
    /** Running cadence — standard Activity API summary fields */
    averageRunCadenceInStepsPerMinute: z.number().optional(),
    maxRunCadenceInStepsPerMinute: z.number().optional(),
    steps: z.number().optional(),
  })
  // Keep unknown fields: rawJson must store what Garmin actually sent.
  // Default Zod strips unknown keys, which silently destroyed fields
  // (e.g. cadence) before they ever reached the database.
  .passthrough();

export const activityPayloadSchema = z.object({
  activities: z.array(activityItemSchema),
});

// ─── Sleep ──────────────────────────────────────────────────────────────────

export const sleepItemSchema = baseItemSchema.extend({
  summaryId: z.string(),
  calendarDate: z.string(),
  startTimeInSeconds: z.number().optional(),
  durationInSeconds: z.number().optional(),
  deepSleepDurationInSeconds: z.number().optional(),
  lightSleepDurationInSeconds: z.number().optional(),
  remSleepInSeconds: z.number().optional(),
  awakeDurationInSeconds: z.number().optional(),
  sleepScores: z
    .object({
      overall: z.object({ value: z.number() }).optional(),
      qualityScore: z.number().optional(),
    })
    .optional(),
});

export const sleepPayloadSchema = z.object({
  sleeps: z.array(sleepItemSchema),
});

// ─── Stress ─────────────────────────────────────────────────────────────────

export const stressItemSchema = baseItemSchema.extend({
  summaryId: z.string(),
  calendarDate: z.string(),
  startTimeInSeconds: z.number().optional(),
  durationInSeconds: z.number().optional(),
  overallStressLevel: z.number().optional(),
  restStressDurationInSeconds: z.number().optional(),
  activityStressDurationInSeconds: z.number().optional(),
  highStressDurationInSeconds: z.number().optional(),
  lowStressDurationInSeconds: z.number().optional(),
  mediumStressDurationInSeconds: z.number().optional(),
  stressValuesArray: z.array(z.array(z.number())).optional(),
});

export const stressPayloadSchema = z.object({
  stressDetails: z.array(stressItemSchema),
});

// ─── HRV ────────────────────────────────────────────────────────────────────

export const hrvItemSchema = baseItemSchema.extend({
  summaryId: z.string(),
  calendarDate: z.string(),
  weeklyAvg: z.number().optional(),
  lastNight: z.number().optional(),
  lastNightAvg: z.number().optional(),
  lastNight5MinHigh: z.number().optional(),
  status: z.string().optional(),
  startTimestampGMT: z.number().optional(),
  endTimestampGMT: z.number().optional(),
});

export const hrvPayloadSchema = z.object({
  hrvSummaries: z.array(hrvItemSchema).optional(),
  allDayHRV: z.array(hrvItemSchema).optional(),
});

// ─── Body Composition ──────────────────────────────────────────────────────

export const bodyCompositionItemSchema = baseItemSchema.extend({
  summaryId: z.string(),
  calendarDate: z.string(),
  weightInGrams: z.number().optional(),
  bodyFatPercentage: z.number().optional(),
  bmi: z.number().optional(),
  muscleMassInGrams: z.number().optional(),
});

export const bodyCompositionPayloadSchema = z.object({
  bodyComps: z.array(bodyCompositionItemSchema),
});

// ─── User Metrics ──────────────────────────────────────────────────────────

export const userMetricsItemSchema = baseItemSchema.extend({
  summaryId: z.string(),
  calendarDate: z.string(),
  vo2Max: z.number().optional(),
  fitnessAge: z.number().optional(),
});

export const userMetricsPayloadSchema = z.object({
  userMetrics: z.array(userMetricsItemSchema),
});

// ─── Activity Files ────────────────────────────────────────────────────────
// Ping-style notification: the actual file must be fetched from callbackURL
// (valid ~24h; re-download after first success returns HTTP 410).

export const activityFileItemSchema = baseItemSchema
  .extend({
    summaryId: z.string(),
    activityId: z.number().optional(),
    fileType: z.string(), // FIT | TCX | GPX
    callbackURL: z.string(),
    startTimeInSeconds: z.number().optional(),
  })
  .passthrough();

export const activityFilesPayloadSchema = z.object({
  activityFiles: z.array(activityFileItemSchema),
});

// ─── Deregistration ────────────────────────────────────────────────────────

export const deregistrationItemSchema = baseItemSchema.extend({
  userRegistrationNumber: z.number().optional(),
});

export const deregistrationPayloadSchema = z.object({
  deregistrations: z.array(deregistrationItemSchema),
});

// ─── Validation Helpers ────────────────────────────────────────────────────

/**
 * Attempt to parse and validate a webhook payload with the given schema.
 * Returns the validated data on success, or null on failure.
 * Validation errors are logged but never thrown.
 */
export function validatePayload<T>(
  schema: z.ZodType<T>,
  data: unknown,
  webhookType: string,
): T | null {
  const result = schema.safeParse(data);
  if (!result.success) {
    console.error(
      `[webhook:${webhookType}] Payload validation failed:`,
      result.error.issues,
    );
    return null;
  }
  return result.data;
}
