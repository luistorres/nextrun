import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { adaptations, trainingPlans } from "@/lib/db/schema";
import {
  applyAdaptation,
  StaleAdaptationError,
} from "@/lib/plan-engine/adaptation-applier";

// ---------------------------------------------------------------------------
// POST /api/plan/adaptations/[id]/accept — Accept a pending adaptation
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

    // Accept and apply within a transaction for atomicity. The accepted IS
    // NULL predicate makes the claim atomic — concurrent accepts cannot
    // double-apply.
    const result = await db.transaction(async (tx) => {
      const claimed = await tx
        .update(adaptations)
        .set({ accepted: true })
        .where(
          and(
            eq(adaptations.id, adaptationId),
            isNull(adaptations.accepted),
            isNull(adaptations.supersededAt),
          ),
        )
        .returning({ id: adaptations.id });

      if (claimed.length === 0) return null;

      return applyAdaptation(tx, session.user.id, adaptationId);
    });

    if (!result) {
      return NextResponse.json(
        { error: "Adaptation already decided" },
        { status: 409 },
      );
    }

    return NextResponse.json({
      message: "Adaptation accepted and applied",
      adaptationId,
      planId: result.planId,
      newPlanVersion: result.newPlanVersion,
      modifiedWorkoutIds: result.modifiedWorkoutIds,
      addedWorkoutIds: result.addedWorkoutIds,
    });
  } catch (error) {
    if (error instanceof StaleAdaptationError) {
      // The transaction rolled back (accepted is NULL again). Mark it
      // replaced, not rejected: the athlete never declined it.
      const { id: adaptationId } = await params;
      await db
        .update(adaptations)
        .set({ supersededAt: new Date() })
        .where(
          and(
            eq(adaptations.id, adaptationId),
            isNull(adaptations.accepted),
            isNull(adaptations.supersededAt),
          ),
        );
      return NextResponse.json(
        { error: "Adaptation superseded — the plan changed since it was proposed" },
        { status: 409 },
      );
    }
    console.error("Accept adaptation error:", error);
    return NextResponse.json(
      { error: "Failed to accept adaptation" },
      { status: 500 },
    );
  }
}
