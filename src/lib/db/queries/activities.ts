import { eq, and, between, desc, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { activities } from "@/lib/db/schema";

/**
 * ON CONFLICT helper: take the incoming (excluded) value unless it is null,
 * in which case keep the existing row's value. Used for enrichment columns
 * (dynamics, training load, lactate threshold) so a re-import from a payload
 * that lacks a field never clobbers a value we already have — e.g. from a
 * richer payload or the FIT decode pipeline.
 */
function keepIfIncomingNull(column: { name: string }): SQL {
  return sql.raw(
    `coalesce(excluded."${column.name}", "activities"."${column.name}")`,
  );
}

// ─── Upsert by Garmin Activity ID ──────────────────────────────────────────
// Ensures idempotent ingestion from Garmin webhooks.

export async function upsertActivity(data: typeof activities.$inferInsert) {
  const [result] = await db
    .insert(activities)
    .values(data)
    .onConflictDoUpdate({
      target: activities.garminActivityId,
      set: {
        activityType: data.activityType,
        startTime: data.startTime,
        durationSeconds: data.durationSeconds,
        distanceMeters: data.distanceMeters,
        avgHeartRate: data.avgHeartRate,
        maxHeartRate: data.maxHeartRate,
        avgPaceSecondsPerKm: data.avgPaceSecondsPerKm,
        elevationGainMeters: data.elevationGainMeters,
        calories: data.calories,
        trainingEffectAerobic: data.trainingEffectAerobic,
        trainingEffectAnaerobic: data.trainingEffectAnaerobic,
        vo2MaxActivity: data.vo2MaxActivity,
        // Enrichment columns: never overwrite an existing non-null value
        // with null (summary payloads vary; FIT decode may have filled these).
        avgRunCadence: keepIfIncomingNull(activities.avgRunCadence),
        maxRunCadence: keepIfIncomingNull(activities.maxRunCadence),
        activityTrainingLoad: keepIfIncomingNull(activities.activityTrainingLoad),
        avgGroundContactTimeMs: keepIfIncomingNull(
          activities.avgGroundContactTimeMs,
        ),
        avgVerticalOscillationMm: keepIfIncomingNull(
          activities.avgVerticalOscillationMm,
        ),
        avgVerticalRatioPct: keepIfIncomingNull(activities.avgVerticalRatioPct),
        avgStrideLengthM: keepIfIncomingNull(activities.avgStrideLengthM),
        lactateThresholdHeartRate: keepIfIncomingNull(
          activities.lactateThresholdHeartRate,
        ),
        lactateThresholdPaceMps: keepIfIncomingNull(
          activities.lactateThresholdPaceMps,
        ),
        // Note: wasPlanned and plannedWorkoutId are intentionally excluded
        // from the conflict update — they are managed by the activity matcher
        // and should not be overwritten when re-syncing activities.
        fitFilePath: data.fitFilePath,
        rawJson: data.rawJson,
      },
    })
    .returning();
  return result;
}

// ─── Get Recent Activities ──────────────────────────────────────────────────

export async function getRecentActivities(userId: string, limit = 10) {
  return db
    .select()
    .from(activities)
    .where(eq(activities.userId, userId))
    .orderBy(desc(activities.startTime))
    .limit(limit);
}

// ─── Get Activities by Date Range ───────────────────────────────────────────

export async function getActivitiesByDateRange(
  userId: string,
  startDate: Date,
  endDate: Date
) {
  return db
    .select()
    .from(activities)
    .where(
      and(
        eq(activities.userId, userId),
        between(activities.startTime, startDate, endDate)
      )
    )
    .orderBy(desc(activities.startTime));
}

// ─── Get Existing Garmin Activity IDs ────────────────────────────────────────
// Used by the importer to distinguish new activities from re-synced ones.

export async function getExistingGarminActivityIds(
  userId: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ gid: activities.garminActivityId })
    .from(activities)
    .where(eq(activities.userId, userId));
  return new Set(rows.map((r) => r.gid).filter((gid): gid is string => gid !== null));
}

// ─── Get Activity by Garmin ID ──────────────────────────────────────────────

export async function getActivityByGarminId(garminActivityId: string) {
  const [result] = await db
    .select()
    .from(activities)
    .where(eq(activities.garminActivityId, garminActivityId))
    .limit(1);
  return result ?? null;
}

// ─── Link Activity to Planned Workout ───────────────────────────────────────

export async function linkActivityToWorkout(
  activityId: string,
  plannedWorkoutId: string
) {
  const [result] = await db
    .update(activities)
    .set({
      wasPlanned: true,
      plannedWorkoutId,
    })
    .where(eq(activities.id, activityId))
    .returning();
  return result;
}
