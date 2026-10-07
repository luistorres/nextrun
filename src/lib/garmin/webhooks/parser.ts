/**
 * Webhook payload parsers.
 *
 * Looks up the internal user by `userAccessToken` (which maps to the
 * `garmin_user_id` field on the garmin_connections table) and transforms
 * Garmin payloads into our internal DB insert shapes.
 *
 * Mapper functions accept Zod-inferred types from the validator schemas
 * to avoid mismatches between validated output and strict interface types.
 */

import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { garminConnections } from "@/lib/db/schema";
import type { ResolvedUser } from "./types";
import type {
  dailySummaryItemSchema,
  activityItemSchema,
  sleepItemSchema,
  stressItemSchema,
  hrvItemSchema,
  bodyCompositionItemSchema,
  userMetricsItemSchema,
} from "./validator";
import type {
  dailySummaries,
  sleepRecords,
  hrvRecords,
  stressRecords,
} from "@/lib/db/schema/health";
import type { activities } from "@/lib/db/schema/activities";

// Infer types from Zod schemas
type DailySummaryItem = z.infer<typeof dailySummaryItemSchema>;
type ActivityItem = z.infer<typeof activityItemSchema>;
type SleepItem = z.infer<typeof sleepItemSchema>;
type StressItem = z.infer<typeof stressItemSchema>;
type HRVItem = z.infer<typeof hrvItemSchema>;
type BodyCompositionItem = z.infer<typeof bodyCompositionItemSchema>;
type UserMetricsItem = z.infer<typeof userMetricsItemSchema>;

// ─── User Lookup ───────────────────────────────────────────────────────────

/**
 * Resolve an internal user from a Garmin `userAccessToken`.
 *
 * The Garmin webhook's `userAccessToken` is the identifier that Garmin uses
 * to identify the user within our application. It maps to the `garmin_user_id`
 * column on the garmin_connections table.
 */
export async function resolveUser(
  userAccessToken: string,
): Promise<ResolvedUser | null> {
  const [connection] = await db
    .select({
      userId: garminConnections.userId,
      garminUserId: garminConnections.garminUserId,
    })
    .from(garminConnections)
    .where(eq(garminConnections.garminUserId, userAccessToken))
    .limit(1);

  if (!connection || !connection.garminUserId) {
    console.warn(
      `[webhook:parser] No user found for userAccessToken: ${userAccessToken}`,
    );
    return null;
  }

  return {
    userId: connection.userId,
    garminUserId: connection.garminUserId,
  };
}

// ─── Update Last Sync ─────────────────────────────────────────────────────

export async function updateLastSync(userId: string): Promise<void> {
  await db
    .update(garminConnections)
    .set({ lastSyncAt: new Date() })
    .where(eq(garminConnections.userId, userId));
}

// ─── Data Mappers ──────────────────────────────────────────────────────────

export function mapDailySummary(
  userId: string,
  item: DailySummaryItem,
): typeof dailySummaries.$inferInsert {
  return {
    userId,
    calendarDate: item.calendarDate,
    steps: item.steps ?? null,
    distanceMeters: item.distanceInMeters?.toString() ?? null,
    activeSeconds: item.activeTimeInSeconds ?? null,
    restingHeartRate: item.restingHeartRateInBeatsPerMinute ?? null,
    minHeartRate: item.minHeartRateInBeatsPerMinute ?? null,
    maxHeartRate: item.maxHeartRateInBeatsPerMinute ?? null,
    averageStressLevel: item.averageStressLevel ?? null,
    bodyBatteryStart: item.bodyBatteryHighestValue ?? null,
    bodyBatteryEnd: item.bodyBatteryMostRecentValue ?? null,
    vo2Max: item.vo2Max?.toString() ?? null,
    respirationAvg: item.averageRespirationValue?.toString() ?? null,
    rawJson: item as typeof dailySummaries.$inferInsert["rawJson"],
  };
}

export function mapActivity(
  userId: string,
  item: ActivityItem,
): typeof activities.$inferInsert {
  // Convert Garmin epoch seconds to JS Date
  const startTime = new Date(item.startTimeInSeconds * 1000);

  // Compute average pace (seconds per km) from speed if available
  let avgPaceSecondsPerKm: string | null = null;
  if (item.averageSpeedInMetersPerSecond && item.averageSpeedInMetersPerSecond > 0) {
    avgPaceSecondsPerKm = (1000 / item.averageSpeedInMetersPerSecond).toFixed(1);
  }

  return {
    userId,
    garminActivityId: String(item.activityId),
    activityType: normalizeActivityType(item.activityType),
    startTime,
    durationSeconds: item.durationInSeconds,
    distanceMeters: item.distanceInMeters?.toString() ?? null,
    avgHeartRate: item.averageHeartRateInBeatsPerMinute ?? null,
    maxHeartRate: item.maxHeartRateInBeatsPerMinute ?? null,
    avgPaceSecondsPerKm,
    elevationGainMeters: item.elevationGainInMeters?.toString() ?? null,
    calories: item.activeKilocalories ?? null,
    trainingEffectAerobic: item.aerobicTrainingEffect?.toString() ?? null,
    trainingEffectAnaerobic: item.anaerobicTrainingEffect?.toString() ?? null,
    vo2MaxActivity: item.vo2MaxValue?.toString() ?? null,
    avgRunCadence: item.averageRunCadenceInStepsPerMinute?.toString() ?? null,
    maxRunCadence: item.maxRunCadenceInStepsPerMinute?.toString() ?? null,
    activityTrainingLoad: item.activityTrainingLoad?.toString() ?? null,
    wasPlanned: false, // Will be updated by activity matcher
    plannedWorkoutId: null,
    rawJson: item as typeof activities.$inferInsert["rawJson"],
  };
}

export function mapSleep(
  userId: string,
  item: SleepItem,
): typeof sleepRecords.$inferInsert {
  // Derive start/end times from epoch if available
  let startTime: Date | null = null;
  let endTime: Date | null = null;
  if (item.startTimeInSeconds) {
    startTime = new Date(item.startTimeInSeconds * 1000);
    if (item.durationInSeconds) {
      endTime = new Date((item.startTimeInSeconds + item.durationInSeconds) * 1000);
    }
  }

  return {
    userId,
    calendarDate: item.calendarDate,
    totalSleepSeconds: item.durationInSeconds ?? null,
    deepSleepSeconds: item.deepSleepDurationInSeconds ?? null,
    lightSleepSeconds: item.lightSleepDurationInSeconds ?? null,
    remSleepSeconds: item.remSleepInSeconds ?? null,
    awakeSeconds: item.awakeDurationInSeconds ?? null,
    sleepScore: item.sleepScores?.overall?.value ?? null,
    startTime,
    endTime,
    rawJson: item as typeof sleepRecords.$inferInsert["rawJson"],
  };
}

export function mapStress(
  userId: string,
  item: StressItem,
): typeof stressRecords.$inferInsert {
  // Map Garmin stress values array to our internal format
  const stressValues = item.stressValuesArray?.map(([timestamp, value]) => ({
    timestamp,
    value,
  })) ?? null;

  return {
    userId,
    calendarDate: item.calendarDate,
    stressValues,
    avgStress: item.overallStressLevel ?? null,
    maxStress: null, // Garmin doesn't provide max stress directly in this payload
    restStressDurationSeconds: item.restStressDurationInSeconds ?? null,
    activityStressDurationSeconds: item.activityStressDurationInSeconds ?? null,
    highStressDurationSeconds: item.highStressDurationInSeconds ?? null,
    rawJson: item as typeof stressRecords.$inferInsert["rawJson"],
  };
}

export function mapHRV(
  userId: string,
  item: HRVItem,
): typeof hrvRecords.$inferInsert {
  return {
    userId,
    calendarDate: item.calendarDate,
    hrvWeeklyAvg: item.weeklyAvg?.toString() ?? null,
    hrvLastNight: item.lastNight?.toString() ?? null,
    hrvStatus: item.status ?? null,
    rawJson: item as typeof hrvRecords.$inferInsert["rawJson"],
  };
}

// ─── Activity Type Normalization ───────────────────────────────────────────

/**
 * Map Garmin activity type strings to our internal enum values.
 * Garmin uses various string identifiers (RUNNING, CYCLING, etc.)
 * which we normalize to a simpler set.
 */
function normalizeActivityType(garminType: string): string {
  const typeMap: Record<string, string> = {
    RUNNING: "run",
    TRAIL_RUNNING: "run",
    TREADMILL_RUNNING: "run",
    TRACK_RUNNING: "run",
    CYCLING: "cycle",
    MOUNTAIN_BIKING: "cycle",
    INDOOR_CYCLING: "cycle",
    SWIMMING: "swim",
    LAP_SWIMMING: "swim",
    OPEN_WATER_SWIMMING: "swim",
    STRENGTH_TRAINING: "strength",
    WALKING: "walk",
    HIKING: "hike",
    YOGA: "yoga",
    PILATES: "yoga",
    PADDELBALL: "padel",
    PADEL: "padel",
    HIIT: "hiit",
    KITESURFING: "kitesurf",
    KITE_SURFING: "kitesurf",
    WIND_KITE_SURFING: "kitesurf",
  };

  return typeMap[garminType.toUpperCase().replace(/\s+/g, "_")] ?? "other";
}

// ─── Body Composition & User Metrics ───────────────────────────────────────
// These don't have dedicated tables in the current schema.
// We store body comp data in daily_summaries via a partial update,
// and user_metrics VO2 max goes into daily_summaries as well.

export function mapBodyComposition(
  userId: string,
  item: BodyCompositionItem,
): {
  userId: string;
  calendarDate: string;
  rawJson: BodyCompositionItem;
} {
  return {
    userId,
    calendarDate: item.calendarDate,
    rawJson: item,
  };
}

export function mapUserMetrics(
  userId: string,
  item: UserMetricsItem,
): {
  userId: string;
  calendarDate: string;
  vo2Max: string | null;
  rawJson: UserMetricsItem;
} {
  return {
    userId,
    calendarDate: item.calendarDate,
    vo2Max: item.vo2Max?.toString() ?? null,
    rawJson: item,
  };
}
