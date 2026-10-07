import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getActivePlanWithWorkouts, getAdaptationHistory } from "@/lib/db/queries/training";

// ---------------------------------------------------------------------------
// GET /api/plan/adaptations — List adaptation history for the active plan
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Find the active plan for this user
    const plan = await getActivePlanWithWorkouts(session.user.id);

    if (!plan) {
      return NextResponse.json(
        { error: "No active plan found" },
        { status: 404 },
      );
    }

    // Fetch adaptation history for this plan
    const history = await getAdaptationHistory(plan.id);

    return NextResponse.json({
      planId: plan.id,
      planVersion: plan.planVersion,
      adaptations: history,
    });
  } catch (error) {
    console.error("Get adaptations error:", error);
    return NextResponse.json(
      { error: "Failed to fetch adaptations" },
      { status: 500 },
    );
  }
}
