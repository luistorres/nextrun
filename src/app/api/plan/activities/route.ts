import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getActivePlanWithWorkouts } from "@/lib/db/queries/training";
import { getActivitiesByDateRange } from "@/lib/db/queries/activities";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ---------------------------------------------------------------------------
// GET /api/plan/activities — All activities spanning the active plan's dates
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const plan = await getActivePlanWithWorkouts(session.user.id);

    if (!plan) {
      return NextResponse.json(
        { error: "No active plan found" },
        { status: 404 },
      );
    }

    // Derive date range covering full weeks (Mon-Sun) of the plan
    const workouts = plan.workouts;
    if (!workouts || workouts.length === 0) {
      return NextResponse.json({ activities: [] });
    }

    const dates = workouts.map((w) => w.scheduledDate);
    const firstDate = dates.reduce((a, b) => (a < b ? a : b));
    const lastDate = dates.reduce((a, b) => (a > b ? a : b));

    // Expand to full week boundaries so unplanned activities on
    // rest days (e.g. Monday with no workout) are included
    const firstDay = new Date(firstDate + "T00:00:00");
    const mondayOfFirst = getMondayOfWeek(firstDay);

    const lastDay = new Date(lastDate + "T00:00:00");
    const sundayOfLast = new Date(getMondayOfWeek(lastDay));
    sundayOfLast.setDate(sundayOfLast.getDate() + 6);

    const startDate = mondayOfFirst;
    const endDate = new Date(
      sundayOfLast.getFullYear(),
      sundayOfLast.getMonth(),
      sundayOfLast.getDate(),
      23, 59, 59, 999,
    );

    const activities = await getActivitiesByDateRange(
      session.user.id,
      startDate,
      endDate,
    );

    // Format using same logic as /api/activities/recent
    const formatted = activities.map((a) => {
      const raw = a.rawJson as Record<string, unknown> | null;
      const name = (raw?.activityName as string) ?? null;
      const garminType =
        typeof raw?.activityType === "object" && raw.activityType !== null
          ? ((raw.activityType as Record<string, unknown>).typeKey as string)
          : null;

      return {
        id: a.id,
        type: a.activityType,
        name,
        garminType,
        startTime: a.startTime.toISOString(),
        durationSeconds: a.durationSeconds,
        distanceMeters: a.distanceMeters ? Number(a.distanceMeters) : null,
        avgHeartRate: a.avgHeartRate,
        avgPaceSecondsPerKm: a.avgPaceSecondsPerKm
          ? Number(a.avgPaceSecondsPerKm)
          : null,
        calories: a.calories,
        wasPlanned: a.wasPlanned,
      };
    });

    return NextResponse.json({ activities: formatted });
  } catch (error) {
    console.error("Plan activities error:", error);
    return NextResponse.json(
      { error: "Failed to fetch plan activities" },
      { status: 500 },
    );
  }
}
