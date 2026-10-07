/**
 * POST /api/garmin/sync
 *
 * Manually pull recent data from Garmin Connect.
 * Uses the unofficial garmin-connect library with stored tokens.
 *
 * Query params:
 *   days - Number of days to sync (default 7, max 90)
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getAuthenticatedClient } from "@/lib/garmin/connect-client";
import { syncRecentData } from "@/lib/garmin/sync-recent";
import { requestPlanReview } from "@/lib/plan-engine/review-request";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // Parse days parameter
  const url = new URL(req.url);
  const daysParam = url.searchParams.get("days");
  const days = Math.min(Math.max(Number(daysParam) || 7, 1), 90);

  // Get authenticated client
  const client = await getAuthenticatedClient(userId);
  if (!client) {
    return NextResponse.json(
      { error: "Garmin account not connected. Please connect first." },
      { status: 404 },
    );
  }

  try {
    const result = await syncRecentData(client, userId, days);
    await requestPlanReview(userId).catch((error) =>
      console.error("[garmin/sync] Plan review request failed:", error),
    );

    return NextResponse.json({
      success: true,
      imported: {
        activities: result.activities,
        newActivities: result.newActivities,
        matchedWorkouts: result.matchedWorkouts,
        dailySummaries: result.dailySummaries,
        sleep: result.sleep,
        hrv: result.hrv,
        stress: result.stress,
      },
      errors: result.errors.length > 0 ? result.errors : undefined,
      message: `Synced ${days} days of data`,
    });
  } catch (error) {
    console.error("[garmin/sync] Sync failed:", error);

    const message = error instanceof Error ? error.message : "Unknown error";

    // Token expiry — user needs to re-login
    if (message.includes("401") || message.includes("Unauthorized")) {
      return NextResponse.json(
        {
          error:
            "Garmin session expired. Please disconnect and reconnect your account.",
        },
        { status: 401 },
      );
    }

    return NextResponse.json(
      { error: "Sync failed. Please try again later." },
      { status: 500 },
    );
  }
}
