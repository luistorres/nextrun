import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { auth } from "@/auth";
import { enqueuePlanGeneration } from "@/lib/queue/producer";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const generatePlanSchema = z.object({
  goalId: z.uuid(),
  /** If true, this is a refinement of an existing plan (e.g., after backfill) */
  isRefinement: z.boolean().optional().default(false),
});

// ---------------------------------------------------------------------------
// POST /api/plan/generate — Trigger plan generation
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const result = generatePlanSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error.issues[0].message },
        { status: 400 },
      );
    }

    const { goalId, isRefinement } = result.data;

    // Enqueue the plan generation job
    const job = await enqueuePlanGeneration({
      userId: session.user.id,
      goalId,
      isRefinement,
    });

    return NextResponse.json(
      {
        message: "Plan generation started",
        jobId: job.id,
        goalId,
      },
      { status: 202 },
    );
  } catch (error) {
    console.error("Plan generation error:", error);
    return NextResponse.json(
      { error: "Failed to start plan generation" },
      { status: 500 },
    );
  }
}
