/**
 * Adaptation applier.
 *
 * When a user accepts an adaptation, this module applies the changes:
 * 1. Updates the plan version
 * 2. Modifies the affected workouts
 * 3. Enqueues Garmin sync for changed workouts
 */

import type { Database, DatabaseOrTransaction } from "@/lib/db";
import type { GeneratedWorkout, AdaptationChange } from "@/types/plan";
import { eq, and, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { enqueueGarminSync } from "@/lib/queue/producer";
import { format } from "date-fns";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ApplyAdaptationResult {
  success: boolean;
  planId: string;
  newPlanVersion: number;
  modifiedWorkoutIds: string[];
  addedWorkoutIds: string[];
}

/**
 * The plan or a targeted workout changed between propose and accept
 * (version moved, or a workout completed). The adaptation must not apply.
 */
export class StaleAdaptationError extends Error {}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function findUpdatedWorkout(
  change: AdaptationChange,
  updatedWorkouts: GeneratedWorkout[] | undefined,
): GeneratedWorkout | undefined {
  if (!updatedWorkouts || updatedWorkouts.length === 0) return undefined;

  const toTitle = change.to?.trim().toLowerCase();
  if (toTitle) {
    const match = updatedWorkouts.find(
      (w) => w.title.trim().toLowerCase() === toTitle,
    );
    if (match) return match;
  }

  return updatedWorkouts.find(
    (w) => w.title.trim().toLowerCase() === change.workoutId.trim().toLowerCase(),
  );
}

export async function getNextSortOrderForDate(
  db: Database | DatabaseOrTransaction,
  planId: string,
  date: string,
): Promise<number> {
  const [result] = await db
    .select({
      maxOrder: sql<number>`coalesce(max(${schema.plannedWorkouts.sortOrder}), -1)`,
    })
    .from(schema.plannedWorkouts)
    .where(
      and(
        eq(schema.plannedWorkouts.planId, planId),
        eq(schema.plannedWorkouts.scheduledDate, date),
      ),
    );
  return (result?.maxOrder ?? -1) + 1;
}

export function dayOfWeekFromDate(date: string): string {
  return format(new Date(date + "T12:00:00"), "EEEE").toLowerCase();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Apply an accepted adaptation to the training plan.
 *
 * @param db - Database instance
 * @param userId - User ID (for ownership verification)
 * @param adaptationId - The adaptation record to apply
 */
export async function applyAdaptation(
  db: Database | DatabaseOrTransaction,
  userId: string,
  adaptationId: string,
): Promise<ApplyAdaptationResult> {
  // ── 1. Load the adaptation record ──────────────────────────────────────
  const [adaptation] = await db
    .select()
    .from(schema.adaptations)
    .where(eq(schema.adaptations.id, adaptationId))
    .limit(1);

  if (!adaptation) {
    throw new Error(`Adaptation ${adaptationId} not found`);
  }

  if (adaptation.accepted !== true) {
    throw new Error(`Adaptation ${adaptationId} has not been accepted`);
  }

  // ── 2. Load and verify the plan ────────────────────────────────────────
  const [plan] = await db
    .select()
    .from(schema.trainingPlans)
    .where(
      and(
        eq(schema.trainingPlans.id, adaptation.planId),
        eq(schema.trainingPlans.userId, userId),
      ),
    )
    .limit(1);

  if (!plan) {
    throw new Error(`Plan ${adaptation.planId} not found for user ${userId}`);
  }

  if (plan.status !== "active") {
    throw new Error(`Plan ${plan.id} is not active (status: ${plan.status})`);
  }

  if (plan.planVersion !== adaptation.oldPlanVersion) {
    throw new StaleAdaptationError(
      `Adaptation ${adaptationId} was proposed against plan version ${adaptation.oldPlanVersion}, but plan ${plan.id} is now at version ${plan.planVersion}`,
    );
  }

  // ── 3. Increment plan version (compare-and-swap; the read check above is
  //       only a fast path — this predicate is what makes it race-safe) ────
  const newVersion = adaptation.newPlanVersion;

  const bumped = await db
    .update(schema.trainingPlans)
    .set({
      planVersion: newVersion,
      generatedBy: "ai_adaptation",
    })
    .where(
      and(
        eq(schema.trainingPlans.id, plan.id),
        eq(schema.trainingPlans.planVersion, adaptation.oldPlanVersion),
      ),
    )
    .returning({ id: schema.trainingPlans.id });

  if (bumped.length === 0) {
    throw new StaleAdaptationError(
      `Plan ${plan.id} moved past version ${adaptation.oldPlanVersion} while applying adaptation ${adaptationId}`,
    );
  }

  // ── 4. Apply individual workout changes ────────────────────────────────
  const modifiedWorkoutIds: string[] = [];
  const addedWorkoutIds: string[] = [];
  const syncWorkoutIds: string[] = [];
  const changes = adaptation.changes;
  const updatedWorkouts = adaptation.updatedWorkouts ?? undefined;

  for (const change of changes) {
    const workoutId = change.workoutId;

    switch (change.change) {
      case "modified": {
        const updated = findUpdatedWorkout(change, updatedWorkouts);
        const modifiedRows = await db
          .update(schema.plannedWorkouts)
          .set({
            title: updated?.title ?? change.to ?? change.from ?? "Modified workout",
            description: updated?.description ?? change.reason,
            workoutType: updated?.type ?? undefined,
            targetDistanceMeters: updated?.targetDistanceMeters ?? undefined,
            targetDurationSeconds: updated?.targetDurationSeconds ?? undefined,
            workoutSteps: updated?.steps ?? undefined,
            adaptationId,
            syncStatus: "pending",
          })
          .where(
            and(
              eq(schema.plannedWorkouts.id, workoutId),
              eq(schema.plannedWorkouts.planId, plan.id),
              eq(schema.plannedWorkouts.completionStatus, "pending"),
            ),
          )
          .returning({ id: schema.plannedWorkouts.id });

        if (modifiedRows.length === 0) {
          throw new StaleAdaptationError(
            `Workout ${workoutId} is no longer pending — adaptation ${adaptationId} is stale`,
          );
        }

        modifiedWorkoutIds.push(workoutId);
        syncWorkoutIds.push(workoutId);
        break;
      }

      case "replaced": {
        const [original] = await db
          .select()
          .from(schema.plannedWorkouts)
          .where(
            and(
              eq(schema.plannedWorkouts.id, workoutId),
              eq(schema.plannedWorkouts.planId, plan.id),
              eq(schema.plannedWorkouts.completionStatus, "pending"),
            ),
          )
          .limit(1);

        if (!original) {
          throw new StaleAdaptationError(
            `Workout ${workoutId} is no longer pending — adaptation ${adaptationId} is stale`,
          );
        }

        const replacedRows = await db
          .update(schema.plannedWorkouts)
          .set({ completionStatus: "replaced" })
          .where(
            and(
              eq(schema.plannedWorkouts.id, workoutId),
              eq(schema.plannedWorkouts.planId, plan.id),
              eq(schema.plannedWorkouts.completionStatus, "pending"),
            ),
          )
          .returning({ id: schema.plannedWorkouts.id });

        if (replacedRows.length === 0) {
          throw new StaleAdaptationError(
            `Workout ${workoutId} is no longer pending — adaptation ${adaptationId} is stale`,
          );
        }

        const updated = findUpdatedWorkout(change, updatedWorkouts);
        const scheduledDate = original.scheduledDate;
        const nextSortOrder = await getNextSortOrderForDate(db, plan.id, scheduledDate);

        const [newWorkout] = await db
          .insert(schema.plannedWorkouts)
          .values({
            planId: plan.id,
            scheduledDate,
            dayOfWeek: original.dayOfWeek,
            workoutType: updated?.type ?? "easy_run",
            title: updated?.title ?? change.to ?? "Replacement workout",
            description: updated?.description ?? change.reason,
            targetDistanceMeters: updated?.targetDistanceMeters ?? original.targetDistanceMeters,
            targetDurationSeconds: updated?.targetDurationSeconds ?? original.targetDurationSeconds,
            targetPaceMinPerKm: original.targetPaceMinPerKm,
            targetHeartRateZone: original.targetHeartRateZone,
            workoutSteps: updated?.steps ?? [],
            sortOrder: nextSortOrder,
            completionStatus: "pending",
            syncStatus: "pending",
            adaptationId,
            originalWorkoutId: workoutId,
          })
          .returning();

        modifiedWorkoutIds.push(workoutId);
        addedWorkoutIds.push(newWorkout.id);
        syncWorkoutIds.push(workoutId, newWorkout.id);
        break;
      }

      case "removed": {
        const removedRows = await db
          .update(schema.plannedWorkouts)
          .set({
            completionStatus: "skipped",
            description: `Removed: ${change.reason}`,
          })
          .where(
            and(
              eq(schema.plannedWorkouts.id, workoutId),
              eq(schema.plannedWorkouts.planId, plan.id),
              eq(schema.plannedWorkouts.completionStatus, "pending"),
            ),
          )
          .returning({ id: schema.plannedWorkouts.id });

        if (removedRows.length === 0) {
          throw new StaleAdaptationError(
            `Workout ${workoutId} is no longer pending — adaptation ${adaptationId} is stale`,
          );
        }

        modifiedWorkoutIds.push(workoutId);
        syncWorkoutIds.push(workoutId);
        break;
      }

      case "rescheduled": {
        const rescheduledRows = await db
          .update(schema.plannedWorkouts)
          .set({
            description: `Rescheduled: ${change.reason}`,
            syncStatus: "pending",
          })
          .where(
            and(
              eq(schema.plannedWorkouts.id, workoutId),
              eq(schema.plannedWorkouts.planId, plan.id),
              eq(schema.plannedWorkouts.completionStatus, "pending"),
            ),
          )
          .returning({ id: schema.plannedWorkouts.id });

        if (rescheduledRows.length === 0) {
          throw new StaleAdaptationError(
            `Workout ${workoutId} is no longer pending — adaptation ${adaptationId} is stale`,
          );
        }

        modifiedWorkoutIds.push(workoutId);
        syncWorkoutIds.push(workoutId);
        break;
      }

      case "added": {
        const updated = findUpdatedWorkout(change, updatedWorkouts);
        const scheduledDate = updated?.day
          ?? change.to
          ?? format(new Date(), "yyyy-MM-dd");

        const isValidDate = /^\d{4}-\d{2}-\d{2}$/.test(scheduledDate);
        const resolvedDate = isValidDate
          ? scheduledDate
          : format(new Date(), "yyyy-MM-dd");

        const nextSortOrder = await getNextSortOrderForDate(db, plan.id, resolvedDate);

        const [newWorkout] = await db
          .insert(schema.plannedWorkouts)
          .values({
            planId: plan.id,
            scheduledDate: resolvedDate,
            dayOfWeek: dayOfWeekFromDate(resolvedDate),
            workoutType: updated?.type ?? "easy_run",
            title: updated?.title ?? change.to ?? "Added workout",
            description: updated?.description ?? change.reason,
            targetDistanceMeters: updated?.targetDistanceMeters ?? undefined,
            targetDurationSeconds: updated?.targetDurationSeconds ?? undefined,
            workoutSteps: updated?.steps ?? [],
            sortOrder: nextSortOrder,
            completionStatus: "pending",
            syncStatus: "pending",
            adaptationId,
          })
          .returning();

        addedWorkoutIds.push(newWorkout.id);
        syncWorkoutIds.push(newWorkout.id);
        break;
      }
    }
  }

  // ── 5. Enqueue Garmin sync ─────────────────────────────────────────────
  // Removed/replaced ids ride the same "update" job on purpose: the sync
  // worker's non-pending guard deletes their Garmin copies (with bookkeeping
  // and retry-on-failure) instead of re-creating them on the athlete's watch.
  if (syncWorkoutIds.length > 0) {
    await enqueueGarminSync({
      userId,
      workoutIds: syncWorkoutIds,
      action: "update",
    });
  }

  return {
    success: true,
    planId: plan.id,
    newPlanVersion: newVersion,
    modifiedWorkoutIds,
    addedWorkoutIds,
  };
}
