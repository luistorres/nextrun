import { NextResponse } from "next/server";
import { and, eq, ne, gte, isNotNull } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { plannedWorkouts, trainingPlans } from "@/lib/db/schema";
import { enqueueGarminSync } from "@/lib/queue/producer";

/**
 * POST /api/plan/sync
 *
 * Bulk-sync all future unsynced workouts from the user's active plan to Garmin.
 * Filters for workouts that:
 *  - belong to the user's active plan
 *  - have a scheduledDate >= today
 *  - are still pending (not skipped/replaced/completed)
 *  - have workoutSteps (required for Garmin structured workouts)
 *  - are not already synced
 *
 * Returns 202 Accepted with the count of enqueued workouts.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Find the user's active plan
  const [plan] = await db
    .select({ id: trainingPlans.id })
    .from(trainingPlans)
    .where(
      and(
        eq(trainingPlans.userId, session.user.id),
        eq(trainingPlans.status, "active"),
      ),
    )
    .limit(1);

  if (!plan) {
    return NextResponse.json(
      { error: "No active plan found" },
      { status: 404 },
    );
  }

  const today = new Date().toISOString().split("T")[0];

  // Get all future workouts that need syncing
  const workoutsToSync = await db
    .select({ id: plannedWorkouts.id })
    .from(plannedWorkouts)
    .where(
      and(
        eq(plannedWorkouts.planId, plan.id),
        gte(plannedWorkouts.scheduledDate, today),
        eq(plannedWorkouts.completionStatus, "pending"),
        ne(plannedWorkouts.syncStatus, "synced"),
        isNotNull(plannedWorkouts.workoutSteps),
      ),
    );

  if (workoutsToSync.length === 0) {
    return NextResponse.json({
      message: "All workouts are already synced",
      count: 0,
    });
  }

  const workoutIds = workoutsToSync.map((w) => w.id);

  const job = await enqueueGarminSync({
    userId: session.user.id,
    workoutIds,
    action: "create",
  });

  return NextResponse.json(
    {
      message: "Sync job enqueued",
      jobId: job.id,
      count: workoutIds.length,
    },
    { status: 202 },
  );
}
