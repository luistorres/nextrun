import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { trainingPlans } from "@/lib/db/schema";
import { getWorkoutsByWeek } from "@/lib/db/queries/training";
import { addDays, startOfWeek, format } from "date-fns";

// ---------------------------------------------------------------------------
// GET /api/plan/week/[weekNum] — Get a specific week's workouts
// ---------------------------------------------------------------------------

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ weekNum: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { weekNum } = await params;
    const weekNumber = parseInt(weekNum, 10);

    if (isNaN(weekNumber) || weekNumber < 1) {
      return NextResponse.json(
        { error: "Invalid week number" },
        { status: 400 },
      );
    }

    // Get active plan
    const [plan] = await db
      .select()
      .from(trainingPlans)
      .where(
        and(
          eq(trainingPlans.userId, session.user.id),
          eq(trainingPlans.status, "active"),
        ),
      )
      .limit(1);

    if (!plan) {
      return NextResponse.json(
        { error: "No active plan found" },
        { status: 404 },
      );
    }

    if (weekNumber > plan.totalWeeks) {
      return NextResponse.json(
        { error: `Week ${weekNumber} exceeds plan length (${plan.totalWeeks} weeks)` },
        { status: 400 },
      );
    }

    // Calculate week date boundaries.
    // Plan starts from the Monday of the week the plan was created.
    const planCreatedDate = new Date(plan.createdAt);
    const planStartMonday = startOfWeek(planCreatedDate, { weekStartsOn: 1 });
    const weekStartDate = addDays(planStartMonday, (weekNumber - 1) * 7);
    const weekEndDate = addDays(weekStartDate, 6);

    const workouts = await getWorkoutsByWeek(
      plan.id,
      format(weekStartDate, "yyyy-MM-dd"),
      format(weekEndDate, "yyyy-MM-dd"),
    );

    return NextResponse.json({
      weekNumber,
      planId: plan.id,
      phase: plan.phase,
      startDate: format(weekStartDate, "yyyy-MM-dd"),
      endDate: format(weekEndDate, "yyyy-MM-dd"),
      workouts,
    });
  } catch (error) {
    console.error("Get week error:", error);
    return NextResponse.json(
      { error: "Failed to fetch week data" },
      { status: 500 },
    );
  }
}
