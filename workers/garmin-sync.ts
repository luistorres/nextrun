/**
 * BullMQ worker for syncing workouts to Garmin.
 *
 * Processes jobs from the garmin-sync queue. Each job contains a list of
 * workout IDs and an action (create, update, delete). For each workout the
 * worker:
 *
 * 1. Loads the planned_workout from the database.
 * 2. Loads the user's Garmin connection and detects the auth type.
 * 3. Formats the workout using the workout-formatter.
 * 4. Dispatches to the correct API:
 *    - Official OAuth  → Garmin Training API (apis.garmin.com)
 *    - Credential login → Garmin Connect web API (connectapi.garmin.com)
 * 5. Updates the planned_workout with the garmin_workout_id and sync_status.
 */

import { Worker } from "bullmq";
import { eq } from "drizzle-orm";
import { createRedisConnection } from "../src/lib/queue/connection";
import { QUEUE_NAMES } from "../src/lib/queue/queues";
import type { GarminSyncJobData } from "../src/lib/queue/job-types";
import { logger } from "./shared/logger";
import { withErrorHandling } from "./shared/error-handler";
import { db } from "./shared/db";
import {
  plannedWorkouts,
  trainingPlans,
  garminConnections,
} from "../src/lib/db/schema";
import { buildGarminWorkout } from "../src/lib/garmin/workout-formatter";
import { decrypt } from "../src/lib/utils/encryption";
import {
  createAndScheduleWorkout,
  deleteWorkout,
  GarminTrainingApiError,
} from "../src/lib/garmin/training-api";
import {
  createAndScheduleWorkoutViaConnect,
  deleteWorkoutViaConnect,
} from "../src/lib/garmin/connect-workout-api";
import type { WorkoutStep, WorkoutType } from "../src/types/plan";

// ─── Auth Helpers ────────────────────────────────────────────────────────────

type GarminAuth =
  | { type: "oauth"; accessToken: string }
  | { type: "credential"; tokenData: string };

async function getGarminAuth(userId: string): Promise<GarminAuth> {
  const [connection] = await db
    .select({ accessToken: garminConnections.accessToken })
    .from(garminConnections)
    .where(eq(garminConnections.userId, userId))
    .limit(1);

  if (!connection) {
    throw new Error(`No Garmin connection found for user ${userId}`);
  }

  const decrypted = decrypt(connection.accessToken);

  // Credential flow (connect-client) stores a JSON blob {"oauth1":...,"oauth2":...};
  // official OAuth stores a bare access token.
  if (decrypted.startsWith("{")) {
    return { type: "credential", tokenData: decrypted };
  }

  return { type: "oauth", accessToken: decrypted };
}

// ─── DB Helpers ──────────────────────────────────────────────────────────────

async function getPlannedWorkout(workoutId: string, userId: string) {
  const [row] = await db
    .select({
      workout: plannedWorkouts,
      planUserId: trainingPlans.userId,
    })
    .from(plannedWorkouts)
    .innerJoin(trainingPlans, eq(plannedWorkouts.planId, trainingPlans.id))
    .where(eq(plannedWorkouts.id, workoutId))
    .limit(1);

  if (!row) {
    throw new Error(`Planned workout ${workoutId} not found`);
  }

  if (row.planUserId !== userId) {
    logger.warn("Workout does not belong to job user, skipping", {
      workoutId,
      jobUserId: userId,
    });
    return null;
  }

  return row.workout;
}

async function updateSyncStatus(
  workoutId: string,
  syncStatus: string,
  garminWorkoutId?: string | null,
) {
  await db
    .update(plannedWorkouts)
    .set({
      syncStatus,
      ...(garminWorkoutId !== undefined ? { garminWorkoutId } : {}),
    })
    .where(eq(plannedWorkouts.id, workoutId));
}

// ─── Sync Actions ───────────────────────────────────────────────────────────

async function syncCreateWorkout(
  auth: GarminAuth,
  workoutId: string,
  userId: string,
) {
  const workout = await getPlannedWorkout(workoutId, userId);
  if (!workout) return;

  // Guard for every caller: a non-pending workout must never be pushed back
  // onto the athlete's watch. Only skipped/replaced also get their Garmin
  // copy deleted — a completed/partial workout must stay on the athlete's
  // Garmin calendar even if someone presses "sync all".
  if (workout.completionStatus !== "pending") {
    const isStale =
      workout.completionStatus === "skipped" ||
      workout.completionStatus === "replaced";

    if (isStale && workout.garminWorkoutId) {
      logger.info("Workout no longer pending, deleting from Garmin", {
        workoutId,
        completionStatus: workout.completionStatus,
        garminWorkoutId: workout.garminWorkoutId,
      });

      try {
        if (auth.type === "oauth") {
          await deleteWorkout(auth.accessToken, workout.garminWorkoutId);
        } else {
          await deleteWorkoutViaConnect(
            auth.tokenData,
            workout.garminWorkoutId,
          );
        }
      } catch (err) {
        // 404: already gone (e.g. deleted manually in Garmin Connect) —
        // clear the id anyway. Anything else rethrows so the per-workout
        // catch marks the row failed with the id kept for a later retry.
        const alreadyGone =
          err instanceof GarminTrainingApiError && err.status === 404;
        if (!alreadyGone) throw err;
      }

      await updateSyncStatus(workoutId, "pending", null);
    } else {
      logger.info("Workout no longer pending, skipping Garmin sync", {
        workoutId,
        completionStatus: workout.completionStatus,
      });
    }
    return;
  }

  if (!workout.workoutSteps || workout.workoutSteps.length === 0) {
    logger.warn("Workout has no steps, skipping Garmin sync", {
      workoutId,
    });
    await updateSyncStatus(workoutId, "failed");
    return;
  }

  // If this workout was previously synced (e.g. before an adaptation),
  // delete the stale version from Garmin first to avoid duplicates.
  if (workout.garminWorkoutId) {
    logger.info("Deleting previous Garmin workout before re-sync", {
      workoutId,
      oldGarminWorkoutId: workout.garminWorkoutId,
    });

    try {
      if (auth.type === "oauth") {
        await deleteWorkout(auth.accessToken, workout.garminWorkoutId);
      } else {
        await deleteWorkoutViaConnect(auth.tokenData, workout.garminWorkoutId);
      }
    } catch (err) {
      // Best-effort: the old workout may already be gone (deleted manually,
      // plan expired, etc.). Log and continue with creating the new one.
      logger.warn("Failed to delete previous Garmin workout, continuing", {
        workoutId,
        oldGarminWorkoutId: workout.garminWorkoutId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const garminDto = buildGarminWorkout(
    workout.title,
    workout.description ?? undefined,
    workout.workoutType as WorkoutType,
    workout.workoutSteps as WorkoutStep[],
    workout.scheduledDate,
  );

  let garminWorkoutId: string;

  if (auth.type === "oauth") {
    garminWorkoutId = await createAndScheduleWorkout(
      auth.accessToken,
      garminDto,
      workout.scheduledDate,
    );
  } else {
    garminWorkoutId = await createAndScheduleWorkoutViaConnect(
      auth.tokenData,
      garminDto,
      workout.scheduledDate,
    );
  }

  await updateSyncStatus(workoutId, "synced", garminWorkoutId);

  logger.info("Workout synced to Garmin", {
    workoutId,
    garminWorkoutId,
    scheduledDate: workout.scheduledDate,
  });
}

async function syncDeleteWorkout(
  auth: GarminAuth,
  workoutId: string,
  userId: string,
) {
  const workout = await getPlannedWorkout(workoutId, userId);
  if (!workout) return;

  if (!workout.garminWorkoutId) {
    logger.warn("Workout has no garmin_workout_id, skipping delete", {
      workoutId,
    });
    return;
  }

  if (auth.type === "oauth") {
    await deleteWorkout(auth.accessToken, workout.garminWorkoutId);
  } else {
    await deleteWorkoutViaConnect(auth.tokenData, workout.garminWorkoutId);
  }

  await updateSyncStatus(workoutId, "pending", null);

  logger.info("Workout deleted from Garmin", {
    workoutId,
    garminWorkoutId: workout.garminWorkoutId,
  });
}

// ─── Worker ─────────────────────────────────────────────────────────────────

export const garminSyncWorker = new Worker<GarminSyncJobData>(
  QUEUE_NAMES.GARMIN_SYNC,
  withErrorHandling(QUEUE_NAMES.GARMIN_SYNC, async (job) => {
    const { userId, workoutIds, action, garminWorkoutIds } = job.data;

    logger.info("Garmin sync job started", {
      queue: QUEUE_NAMES.GARMIN_SYNC,
      jobId: job.id,
      userId,
      action,
      workoutCount: workoutIds.length,
      garminWorkoutCount: garminWorkoutIds?.length ?? 0,
    });

    const auth = await getGarminAuth(userId);

    logger.info("Garmin auth resolved", {
      userId,
      authType: auth.type,
    });

    // For delete actions with garminWorkoutIds, delete directly from Garmin
    // without looking up DB rows (which may already be cascade-deleted).
    if (action === "delete" && garminWorkoutIds && garminWorkoutIds.length > 0) {
      for (const garminId of garminWorkoutIds) {
        try {
          if (auth.type === "oauth") {
            await deleteWorkout(auth.accessToken, garminId);
          } else {
            await deleteWorkoutViaConnect(auth.tokenData, garminId);
          }
          logger.info("Workout deleted from Garmin (direct)", {
            garminWorkoutId: garminId,
          });
        } catch (err) {
          logger.warn("Failed to delete workout from Garmin (direct)", {
            garminWorkoutId: garminId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // Process workoutIds (DB-backed operations)
    for (const workoutId of workoutIds) {
      try {
        switch (action) {
          case "create":
          case "update":
            // For updates, we create a new workout on Garmin (re-sync)
            await syncCreateWorkout(auth, workoutId, userId);
            break;
          case "delete":
            await syncDeleteWorkout(auth, workoutId, userId);
            break;
          default:
            logger.warn("Unknown sync action, skipping", {
              action,
              workoutId,
            });
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        logger.error("Failed to sync individual workout", {
          workoutId,
          action,
          error: error.message,
        });

        // Mark this workout as failed but continue with the rest
        await updateSyncStatus(workoutId, "failed").catch((updateErr) => {
          logger.error("Failed to update sync status to failed", {
            workoutId,
            error:
              updateErr instanceof Error
                ? updateErr.message
                : String(updateErr),
          });
        });
      }
    }

    logger.info("Garmin sync job completed", {
      jobId: job.id,
      userId,
      action,
      workoutCount: workoutIds.length,
    });
  }),
  {
    connection: createRedisConnection(),
    concurrency: 1,
  },
);
