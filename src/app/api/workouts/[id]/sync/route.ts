import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { plannedWorkouts, trainingPlans } from "@/lib/db/schema";
import { enqueueGarminSync } from "@/lib/queue/producer";

/**
 * POST /api/workouts/[id]/sync
 *
 * Manually trigger a Garmin sync for a specific planned workout.
 * Enqueues a garmin-sync job and returns 202 Accepted.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: workoutId } = await params;

  // Look up the workout and verify ownership via the training plan
  const [workout] = await db
    .select({
      id: plannedWorkouts.id,
      planId: plannedWorkouts.planId,
      syncStatus: plannedWorkouts.syncStatus,
      workoutSteps: plannedWorkouts.workoutSteps,
    })
    .from(plannedWorkouts)
    .where(eq(plannedWorkouts.id, workoutId))
    .limit(1);

  if (!workout) {
    return NextResponse.json(
      { error: "Workout not found" },
      { status: 404 },
    );
  }

  // Verify the workout belongs to the authenticated user
  const [plan] = await db
    .select({ userId: trainingPlans.userId })
    .from(trainingPlans)
    .where(eq(trainingPlans.id, workout.planId))
    .limit(1);

  if (!plan || plan.userId !== session.user.id) {
    return NextResponse.json(
      { error: "Workout not found" },
      { status: 404 },
    );
  }

  if (!workout.workoutSteps || workout.workoutSteps.length === 0) {
    return NextResponse.json(
      { error: "Workout has no steps to sync" },
      { status: 422 },
    );
  }

  // Mark as syncing so the UI can show progress immediately
  await db
    .update(plannedWorkouts)
    .set({ syncStatus: "syncing" })
    .where(eq(plannedWorkouts.id, workoutId));

  // Enqueue the sync job
  const job = await enqueueGarminSync({
    userId: session.user.id,
    workoutIds: [workoutId],
    action: "create",
  });

  return NextResponse.json(
    {
      message: "Sync job enqueued",
      jobId: job.id,
      workoutId,
    },
    { status: 202 },
  );
}
