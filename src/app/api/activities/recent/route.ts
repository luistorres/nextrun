import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getRecentActivities,
  getActivitiesByDateRange,
} from "@/lib/db/queries/activities";

// ---------------------------------------------------------------------------
// GET /api/activities/recent — Activities by date range (or last 50)
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = request.nextUrl;
    const start = searchParams.get("start");
    const end = searchParams.get("end");

    const activities =
      start && end
        ? await getActivitiesByDateRange(
            session.user.id,
            new Date(start),
            new Date(end)
          )
        : await getRecentActivities(session.user.id, 50);

    // Format activities for the frontend
    const formatted = activities.map((a) => {
      // Extract the activity name and original Garmin type from rawJson
      const raw = a.rawJson as Record<string, unknown> | null;
      const name = (raw?.activityName as string) ?? null;
      const garminType =
        typeof raw?.activityType === "object" && raw.activityType !== null
          ? (raw.activityType as Record<string, unknown>).typeKey as string
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
        trainingEffectAerobic: a.trainingEffectAerobic
          ? Number(a.trainingEffectAerobic)
          : null,
        trainingEffectAnaerobic: a.trainingEffectAnaerobic
          ? Number(a.trainingEffectAnaerobic)
          : null,
        wasPlanned: a.wasPlanned,
      };
    });

    return NextResponse.json({ activities: formatted });
  } catch (error) {
    console.error("Recent activities error:", error);
    return NextResponse.json(
      { error: "Failed to fetch recent activities" },
      { status: 500 }
    );
  }
}
