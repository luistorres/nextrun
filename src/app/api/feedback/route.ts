import { NextResponse } from "next/server";
import { eq, and, gte, desc } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { workoutFeedback } from "@/lib/db/schema";
import type { FeedbackSentiment, FeedbackType, PainArea } from "@/lib/db/schema/training";
import { subDays } from "date-fns";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const painAreaSchema = z.object({
  area: z.string().min(1),
  severity: z.enum(["mild", "moderate", "severe"]),
});

const dailyCheckinSchema = z.object({
  sentiment: z
    .enum([
      "feeling_great",
      "feeling_good",
      "feeling_okay",
      "feeling_tired",
      "feeling_terrible",
    ])
    .optional(),
  contextualNotes: z.string().max(1000).optional(),
  painAreas: z.array(painAreaSchema).max(10).optional(),
  externalStressors: z.array(z.string().max(100)).max(10).optional(),
});

// ---------------------------------------------------------------------------
// POST /api/feedback — Submit a general daily check-in
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = dailyCheckinSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid feedback data", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const data = parsed.data;

    // Check if user already checked in today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const existing = await db
      .select({ id: workoutFeedback.id })
      .from(workoutFeedback)
      .where(
        and(
          eq(workoutFeedback.userId, session.user.id),
          eq(workoutFeedback.feedbackType, "daily_checkin"),
          gte(workoutFeedback.createdAt, todayStart),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      const [updated] = await db
        .update(workoutFeedback)
        .set({
          sentiment: data.sentiment as FeedbackSentiment | undefined,
          contextualNotes: data.contextualNotes,
          painAreas: data.painAreas as PainArea[] | undefined,
          externalStressors: data.externalStressors,
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
        sentiment: data.sentiment as FeedbackSentiment | undefined,
        contextualNotes: data.contextualNotes,
        painAreas: data.painAreas as PainArea[] | undefined,
        externalStressors: data.externalStressors,
        feedbackType: "daily_checkin" as FeedbackType,
      })
      .returning();

    return NextResponse.json({ feedback: created }, { status: 201 });
  } catch (error) {
    console.error("Submit daily check-in error:", error);
    return NextResponse.json(
      { error: "Failed to submit check-in" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// GET /api/feedback — Get recent feedback entries (last 7 days)
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sevenDaysAgo = subDays(new Date(), 7);

    const entries = await db
      .select()
      .from(workoutFeedback)
      .where(
        and(
          eq(workoutFeedback.userId, session.user.id),
          gte(workoutFeedback.createdAt, sevenDaysAgo),
        ),
      )
      .orderBy(desc(workoutFeedback.createdAt))
      .limit(50);

    // Check if the user already checked in today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const checkedInToday = entries.some(
      (e) =>
        e.feedbackType === "daily_checkin" && e.createdAt >= todayStart,
    );

    return NextResponse.json({ feedback: entries, checkedInToday });
  } catch (error) {
    console.error("Get recent feedback error:", error);
    return NextResponse.json(
      { error: "Failed to fetch feedback" },
      { status: 500 },
    );
  }
}
