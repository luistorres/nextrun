import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { plannedWorkouts, trainingPlans } from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// POST /api/workouts/[id]/skip — Skip a workout with an optional reason
// ---------------------------------------------------------------------------

const skipSchema = z.object({
  reason: z.string().max(500).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: workoutId } = await params;

    const body = await request.json().catch(() => ({}));
    const parsed = skipSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    // Load the workout
    const [workout] = await db
      .select({
        id: plannedWorkouts.id,
        planId: plannedWorkouts.planId,
        completionStatus: plannedWorkouts.completionStatus,
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

    // Verify ownership via plan
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

    const [updated] = await db
      .update(plannedWorkouts)
      .set({
        completionStatus: "skipped",
        ...(parsed.data.reason && { skipReason: parsed.data.reason }),
      })
      .where(eq(plannedWorkouts.id, workoutId))
      .returning();

    return NextResponse.json({
      workout: {
        id: updated.id,
        completionStatus: updated.completionStatus,
        skipReason: parsed.data.reason ?? null,
      },
    });
  } catch (error) {
    console.error("Skip workout error:", error);
    return NextResponse.json(
      { error: "Failed to skip workout" },
      { status: 500 },
    );
  }
}
