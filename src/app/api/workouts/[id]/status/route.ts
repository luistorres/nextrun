import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { plannedWorkouts, trainingPlans } from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// PATCH /api/workouts/[id]/status — Update workout completion status
// ---------------------------------------------------------------------------

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: workoutId } = await params;
    const body = await request.json();
    const { status, rpeScore, perceivedDifficulty } = body;

    // Validate the status value
    const validStatuses = ["completed", "skipped", "partial", "pending"];
    if (!status || !validStatuses.includes(status)) {
      return NextResponse.json(
        {
          error: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
        },
        { status: 400 },
      );
    }

    // Validate optional RPE score (Borg CR-10: 1–10)
    if (rpeScore !== undefined) {
      if (typeof rpeScore !== "number" || !Number.isInteger(rpeScore) || rpeScore < 1 || rpeScore > 10) {
        return NextResponse.json(
          { error: "Invalid rpeScore. Must be an integer between 1 and 10." },
          { status: 400 },
        );
      }
    }

    // Validate optional perceived difficulty
    const validDifficulties = ["much_easier_than_expected", "easier_than_expected", "as_expected", "harder_than_expected", "much_harder_than_expected"];
    if (perceivedDifficulty !== undefined && !validDifficulties.includes(perceivedDifficulty)) {
      return NextResponse.json(
        { error: `Invalid perceivedDifficulty. Must be one of: ${validDifficulties.join(", ")}` },
        { status: 400 },
      );
    }

    // Load the workout
    const [workout] = await db
      .select({
        id: plannedWorkouts.id,
        planId: plannedWorkouts.planId,
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

    // Update the status (+ optional RPE fields)
    const [updated] = await db
      .update(plannedWorkouts)
      .set({
        completionStatus: status,
        ...(rpeScore !== undefined && { rpeScore }),
        ...(perceivedDifficulty !== undefined && { perceivedDifficulty }),
      })
      .where(eq(plannedWorkouts.id, workoutId))
      .returning();

    return NextResponse.json({
      workout: {
        id: updated.id,
        completionStatus: updated.completionStatus,
        rpeScore: updated.rpeScore,
        perceivedDifficulty: updated.perceivedDifficulty,
      },
    });
  } catch (error) {
    console.error("Update workout status error:", error);
    return NextResponse.json(
      { error: "Failed to update workout status" },
      { status: 500 },
    );
  }
}
