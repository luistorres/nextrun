import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { plannedWorkouts, trainingPlans, workoutFeedback } from "@/lib/db/schema";
import type { FeedbackSentiment, FeedbackType, PainArea } from "@/lib/db/schema/training";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const painAreaSchema = z.object({
  area: z.string().min(1),
  severity: z.enum(["mild", "moderate", "severe"]),
});

const feedbackSchema = z.object({
  sentiment: z
    .enum([
      "feeling_great",
      "feeling_good",
      "feeling_okay",
      "feeling_tired",
      "feeling_terrible",
    ])
    .optional(),
  reasonForMiss: z.string().max(500).optional(),
  contextualNotes: z.string().max(1000).optional(),
  painAreas: z.array(painAreaSchema).max(10).optional(),
  externalStressors: z.array(z.string().max(100)).max(10).optional(),
  feedbackType: z
    .enum(["post_workout", "skip_reason", "daily_checkin", "general"])
    .optional()
    .default("post_workout"),
});

// ---------------------------------------------------------------------------
// POST /api/workouts/[id]/feedback — Create or update feedback for a workout
// ---------------------------------------------------------------------------

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
    const body = await request.json();
    const parsed = feedbackSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid feedback data", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    // Verify workout exists and belongs to user
    const workout = await db
      .select({
        id: plannedWorkouts.id,
        planId: plannedWorkouts.planId,
      })
      .from(plannedWorkouts)
      .where(eq(plannedWorkouts.id, workoutId))
      .limit(1);

    if (workout.length === 0) {
      return NextResponse.json(
        { error: "Workout not found" },
        { status: 404 },
      );
    }

    const [plan] = await db
      .select({ userId: trainingPlans.userId })
      .from(trainingPlans)
      .where(eq(trainingPlans.id, workout[0].planId))
      .limit(1);

    if (!plan || plan.userId !== session.user.id) {
      return NextResponse.json(
        { error: "Workout not found" },
        { status: 404 },
      );
    }

    // Check for existing feedback for this workout
    const existing = await db
      .select({ id: workoutFeedback.id })
      .from(workoutFeedback)
      .where(
        and(
          eq(workoutFeedback.userId, session.user.id),
          eq(workoutFeedback.plannedWorkoutId, workoutId),
        ),
      )
      .limit(1);

    const data = parsed.data;

    if (existing.length > 0) {
      const [updated] = await db
        .update(workoutFeedback)
        .set({
          sentiment: data.sentiment as FeedbackSentiment | undefined,
          reasonForMiss: data.reasonForMiss,
          contextualNotes: data.contextualNotes,
          painAreas: data.painAreas as PainArea[] | undefined,
          externalStressors: data.externalStressors,
          feedbackType: data.feedbackType as FeedbackType,
          updatedAt: new Date(),
        })
        .where(eq(workoutFeedback.id, existing[0].id))
        .returning();

      return NextResponse.json({ feedback: updated });
    }

    const [created] = await db
      .insert(workoutFeedback)
      .values({
        userId: session.user.id,
        plannedWorkoutId: workoutId,
        sentiment: data.sentiment as FeedbackSentiment | undefined,
        reasonForMiss: data.reasonForMiss,
        contextualNotes: data.contextualNotes,
        painAreas: data.painAreas as PainArea[] | undefined,
        externalStressors: data.externalStressors,
        feedbackType: data.feedbackType as FeedbackType,
      })
      .returning();

    return NextResponse.json({ feedback: created }, { status: 201 });
  } catch (error) {
    console.error("Submit workout feedback error:", error);
    return NextResponse.json(
      { error: "Failed to submit feedback" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// GET /api/workouts/[id]/feedback — Get feedback for a specific workout
// ---------------------------------------------------------------------------

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: workoutId } = await params;

    const feedback = await db
      .select()
      .from(workoutFeedback)
      .where(
        and(
          eq(workoutFeedback.userId, session.user.id),
          eq(workoutFeedback.plannedWorkoutId, workoutId),
        ),
      )
      .limit(1);

    if (feedback.length === 0) {
      return NextResponse.json({ feedback: null });
    }

    return NextResponse.json({ feedback: feedback[0] });
  } catch (error) {
    console.error("Get workout feedback error:", error);
    return NextResponse.json(
      { error: "Failed to fetch feedback" },
      { status: 500 },
    );
  }
}
