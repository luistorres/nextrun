import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { plannedWorkouts, trainingPlans } from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// POST /api/workouts/[id]/reschedule — Move a workout to a new date
// ---------------------------------------------------------------------------

const rescheduleSchema = z.object({
  newDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .refine(
      (d) => !isNaN(new Date(d + "T00:00:00").getTime()),
      "Invalid date",
    ),
});

const DAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

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

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json(
        { error: "Request body is required" },
        { status: 400 },
      );
    }

    const parsed = rescheduleSchema.safeParse(body);
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

    // Prevent rescheduling completed/skipped workouts
    if (workout.completionStatus === "completed" || workout.completionStatus === "skipped") {
      return NextResponse.json(
        { error: "Cannot reschedule a workout that has already been completed or skipped" },
        { status: 400 },
      );
    }

    // Derive the day of week for the new date
    const newDate = new Date(parsed.data.newDate + "T00:00:00");
    const dayOfWeek = DAY_NAMES[newDate.getDay()];

    // Update the workout date
    const [updated] = await db
      .update(plannedWorkouts)
      .set({
        scheduledDate: parsed.data.newDate,
        dayOfWeek,
        syncStatus: "pending",
      })
      .where(eq(plannedWorkouts.id, workoutId))
      .returning();

    return NextResponse.json({
      workout: {
        id: updated.id,
        scheduledDate: updated.scheduledDate,
        dayOfWeek: updated.dayOfWeek,
        completionStatus: updated.completionStatus,
      },
    });
  } catch (error) {
    console.error("Reschedule workout error:", error);
    return NextResponse.json(
      { error: "Failed to reschedule workout" },
      { status: 500 },
    );
  }
}
