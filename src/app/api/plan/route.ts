import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { auth } from "@/auth";
import { getActivePlanWithWorkouts } from "@/lib/db/queries/training";
import { db } from "@/lib/db";
import { trainingPlans, userGoals } from "@/lib/db/schema";
import { enqueueGarminSync } from "@/lib/queue/producer";
import {
  calculatePeriodization,
  getPhaseForWeek,
} from "@/lib/plan-engine/periodization";
import { differenceInWeeks, startOfWeek, parseISO } from "date-fns";

// ---------------------------------------------------------------------------
// GET /api/plan — Get the current active plan with all workouts
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const plan = await getActivePlanWithWorkouts(session.user.id);

    if (!plan) {
      return NextResponse.json(
        { error: "No active plan found" },
        { status: 404 },
      );
    }

    // Compute currentWeek and phase dynamically from workout dates
    const enrichedPlan = computeCurrentProgress(plan);

    return NextResponse.json({ plan: enrichedPlan });
  } catch (error) {
    console.error("Get plan error:", error);
    return NextResponse.json(
      { error: "Failed to fetch plan" },
      { status: 500 },
    );
  }
}

/**
 * Compute the current week, total weeks, and training phase based on
 * today's date relative to the plan's actual workout date range.
 *
 * totalWeeks is recomputed from the first/last workout dates so the
 * calendar always covers the full plan including race week.
 */
function computeCurrentProgress<
  T extends {
    totalWeeks: number;
    currentWeek: number;
    phase: string;
    workouts: { scheduledDate: string }[];
    goal?: { targetDistanceMeters: number } | null;
  },
>(plan: T): T {
  const firstWorkout = plan.workouts[0];
  const lastWorkout = plan.workouts[plan.workouts.length - 1];
  if (!firstWorkout || !lastWorkout) return plan;

  const planStartMonday = startOfWeek(parseISO(firstWorkout.scheduledDate), {
    weekStartsOn: 1,
  });
  const lastWorkoutDate = parseISO(lastWorkout.scheduledDate);
  const todayMonday = startOfWeek(new Date(), { weekStartsOn: 1 });

  // Compute actual weeks needed to cover all workouts
  const msSpan = lastWorkoutDate.getTime() - planStartMonday.getTime();
  const actualTotalWeeks = Math.max(
    plan.totalWeeks,
    Math.floor(msSpan / (7 * 24 * 60 * 60 * 1000)) + 1,
  );

  const weeksSinceStart = differenceInWeeks(todayMonday, planStartMonday);
  const currentWeek = Math.max(1, Math.min(weeksSinceStart + 1, actualTotalWeeks));

  // Pass the goal distance so the displayed phase uses the same
  // race-distance-aware taper as plan generation.
  const periodization = calculatePeriodization(
    actualTotalWeeks,
    plan.goal?.targetDistanceMeters,
  );
  const phase = getPhaseForWeek(periodization, currentWeek);

  return { ...plan, currentWeek, phase, totalWeeks: actualTotalWeeks };
}

// ---------------------------------------------------------------------------
// DELETE /api/plan — Delete active plan, remove synced workouts from Garmin
// ---------------------------------------------------------------------------

export async function DELETE() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const plan = await getActivePlanWithWorkouts(userId);

    if (!plan) {
      return NextResponse.json(
        { error: "No active plan found" },
        { status: 404 },
      );
    }

    // Collect Garmin workout IDs for synced workouts
    const garminWorkoutIds = plan.workouts
      .map((w) => w.garminWorkoutId)
      .filter((id): id is string => id !== null);

    // Delete the plan (cascades to workouts + adaptations)
    await db
      .delete(trainingPlans)
      .where(
        and(
          eq(trainingPlans.id, plan.id),
          eq(trainingPlans.userId, userId),
        ),
      );

    // Enqueue Garmin deletes AFTER DB deletion (uses garminWorkoutIds directly,
    // doesn't need DB rows)
    if (garminWorkoutIds.length > 0) {
      await enqueueGarminSync({
        userId,
        workoutIds: [],
        action: "delete",
        garminWorkoutIds,
      });
    }

    // Reset the goal so user can generate a new plan
    await db
      .update(userGoals)
      .set({ status: "active" })
      .where(
        and(
          eq(userGoals.id, plan.goalId),
          eq(userGoals.userId, userId),
        ),
      );

    return NextResponse.json({
      success: true,
      deleted: {
        planId: plan.id,
        workouts: plan.workouts.length,
        garminDeletesQueued: garminWorkoutIds.length,
      },
    });
  } catch (error) {
    console.error("Delete plan error:", error);
    return NextResponse.json(
      { error: "Failed to delete plan" },
      { status: 500 },
    );
  }
}
