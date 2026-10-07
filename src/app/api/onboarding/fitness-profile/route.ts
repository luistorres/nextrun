import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { computeFitnessProfile } from "@/lib/metrics/fitness-profile";

// ---------------------------------------------------------------------------
// GET /api/onboarding/fitness-profile — Compute fitness profile from Garmin data
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const profile = await computeFitnessProfile(db, session.user.id);

    return NextResponse.json({
      profile,
      hasData: profile !== null,
    });
  } catch (error) {
    console.error("Fitness profile error:", error);
    return NextResponse.json(
      { error: "Failed to compute fitness profile" },
      { status: 500 },
    );
  }
}
