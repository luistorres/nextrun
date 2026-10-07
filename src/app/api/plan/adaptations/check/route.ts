import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { requestPlanReview } from "@/lib/plan-engine/review-request";

// POST /api/plan/adaptations/check — called when the athlete opens the app
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json(await requestPlanReview(session.user.id));
  } catch (error) {
    console.error("Plan review request error:", error);
    return NextResponse.json(
      { error: "Failed to request a plan review" },
      { status: 500 },
    );
  }
}
