import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { adaptations, trainingPlans } from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// POST /api/plan/adaptations/[id]/reject — Reject a pending adaptation
// ---------------------------------------------------------------------------

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: adaptationId } = await params;

    // Load the adaptation and verify ownership
    const [adaptation] = await db
      .select({
        id: adaptations.id,
        planId: adaptations.planId,
        accepted: adaptations.accepted,
        supersededAt: adaptations.supersededAt,
      })
      .from(adaptations)
      .where(eq(adaptations.id, adaptationId))
      .limit(1);

    if (!adaptation) {
      return NextResponse.json(
        { error: "Adaptation not found" },
        { status: 404 },
      );
    }

    // Verify the plan belongs to this user
    const [plan] = await db
      .select({ userId: trainingPlans.userId })
      .from(trainingPlans)
      .where(eq(trainingPlans.id, adaptation.planId))
      .limit(1);

    if (!plan || plan.userId !== session.user.id) {
      return NextResponse.json(
        { error: "Adaptation not found" },
        { status: 404 },
      );
    }

    if (adaptation.supersededAt !== null) {
      return NextResponse.json(
        { error: "This proposal was replaced by a newer one" },
        { status: 409 },
      );
    }

    // Check if already decided
    if (adaptation.accepted !== null) {
      return NextResponse.json(
        {
          error: `Adaptation already ${adaptation.accepted ? "accepted" : "rejected"}`,
        },
        { status: 409 },
      );
    }

    // accepted IS NULL keeps a reject racing a committed accept from
    // silently flipping the record.
    const rejected = await db
      .update(adaptations)
      .set({ accepted: false })
      .where(
        and(
          eq(adaptations.id, adaptationId),
          isNull(adaptations.accepted),
          isNull(adaptations.supersededAt),
        ),
      )
      .returning({ id: adaptations.id });

    if (rejected.length === 0) {
      return NextResponse.json(
        { error: "Adaptation already decided" },
        { status: 409 },
      );
    }

    return NextResponse.json({
      message: "Adaptation rejected",
      adaptationId,
    });
  } catch (error) {
    console.error("Reject adaptation error:", error);
    return NextResponse.json(
      { error: "Failed to reject adaptation" },
      { status: 500 },
    );
  }
}
