/**
 * Activity-to-planned-workout matcher.
 *
 * When a new activity arrives via webhook, we attempt to match it against a
 * planned workout in the user's active training plan. Matching criteria:
 *
 * 1. Same user
 * 2. Activity date matches the workout's scheduled_date
 * 3. Activity type is compatible with the workout type
 *
 * If matched, the activity is linked to the planned workout and the workout's
 * completion status is updated to "completed".
 */

import { format } from "date-fns";
import {
  getActivePlanWithWorkouts,
  updateWorkoutStatus,
} from "@/lib/db/queries/training";
import { linkActivityToWorkout } from "@/lib/db/queries/activities";

// ─── Workout Type Compatibility Map ─────────────────────────────────────────
// Maps our internal activity types to the set of workout types they can fulfill.

const ACTIVITY_TO_WORKOUT_TYPES: Record<string, string[]> = {
  run: [
    "easy_run",
    "long_run",
    "tempo",
    "intervals",
    "recovery",
    "fartlek",
    "hill_repeats",
    "race_pace",
  ],
  cycle: ["cross_training"],
  swim: ["cross_training"],
  walk: ["recovery", "cross_training"],
  hike: ["cross_training"],
  strength: ["cross_training"],
  yoga: ["cross_training", "recovery"],
  other: ["cross_training"],
};

// ─── Match & Link ──────────────────────────────────────────────────────────

export interface MatchResult {
  matched: boolean;
  plannedWorkoutId?: string;
  planId?: string;
}

/**
 * Attempt to match a completed activity to a planned workout.
 *
 * @param userId - Internal user ID
 * @param activityId - The stored activity row ID
 * @param activityType - Normalized activity type (run, cycle, etc.)
 * @param activityStartTime - When the activity started
 * @returns Match result indicating whether a workout was found and linked
 */
export async function matchActivityToWorkout(
  userId: string,
  activityId: string,
  activityType: string,
  activityStartTime: Date,
): Promise<MatchResult> {
  try {
    // Get the user's active training plan with all workouts
    const plan = await getActivePlanWithWorkouts(userId);
    if (!plan) {
      return { matched: false };
    }

    // Determine the activity date in YYYY-MM-DD format
    const activityDate = format(activityStartTime, "yyyy-MM-dd");

    // Get compatible workout types for this activity
    const compatibleWorkoutTypes = ACTIVITY_TO_WORKOUT_TYPES[activityType] ?? [];

    // Phase 1: Find a PENDING workout on the same date (first activity for a workout)
    const pendingWorkout = plan.workouts.find((workout) => {
      return (
        workout.scheduledDate === activityDate &&
        workout.completionStatus === "pending" &&
        compatibleWorkoutTypes.includes(workout.workoutType)
      );
    });

    if (pendingWorkout) {
      await linkActivityToWorkout(activityId, pendingWorkout.id);
      await updateWorkoutStatus(pendingWorkout.id, "completed", activityId);

      console.info(
        `[webhook:activity-matcher] Primary match: activity ${activityId} → workout ${pendingWorkout.id} ` +
          `(${pendingWorkout.workoutType} on ${activityDate})`,
      );

      return {
        matched: true,
        plannedWorkoutId: pendingWorkout.id,
        planId: plan.id,
      };
    }

    // Phase 2: Find an already-COMPLETED workout on the same date (secondary activity).
    // This handles split sessions — e.g. two easy runs that together satisfy a single
    // planned workout. We link via plannedWorkoutId but don't overwrite completedActivityId.
    const completedWorkout = plan.workouts.find((workout) => {
      return (
        workout.scheduledDate === activityDate &&
        workout.completionStatus === "completed" &&
        compatibleWorkoutTypes.includes(workout.workoutType)
      );
    });

    if (completedWorkout) {
      await linkActivityToWorkout(activityId, completedWorkout.id);

      console.info(
        `[webhook:activity-matcher] Secondary match: activity ${activityId} → workout ${completedWorkout.id} ` +
          `(additional ${activityType} on ${activityDate})`,
      );

      return {
        matched: true,
        plannedWorkoutId: completedWorkout.id,
        planId: plan.id,
      };
    }

    return { matched: false };
  } catch (error) {
    console.error(
      `[webhook:activity-matcher] Error matching activity ${activityId}:`,
      error,
    );
    return { matched: false };
  }
}
