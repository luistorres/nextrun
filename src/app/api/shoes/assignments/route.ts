import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gte, isNotNull, lte } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { activities } from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// GET /api/shoes/assignments — Activity → shoe assignments for the feed
// ---------------------------------------------------------------------------
// Returns assignments for activities in the given date range (or the last 50
// activities, mirroring /api/activities/recent), so the dashboard feed can
// show which shoe each run was logged with without changing that endpoint.

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = request.nextUrl;
    const start = searchParams.get("start");
    const end = searchParams.get("end");

    const baseConditions = [
      eq(activities.userId, session.user.id),
      isNotNull(activities.shoeId),
    ];

    const rows =
      start && end
        ? await db
            .select({ activityId: activities.id, shoeId: activities.shoeId })
            .from(activities)
            .where(
              and(
                ...baseConditions,
                gte(activities.startTime, new Date(start)),
                lte(activities.startTime, new Date(end)),
              ),
            )
        : await db
            .select({ activityId: activities.id, shoeId: activities.shoeId })
            .from(activities)
            .where(and(...baseConditions))
            .orderBy(desc(activities.startTime))
            .limit(50);

    return NextResponse.json({ assignments: rows });
  } catch (error) {
    console.error("Shoe assignments error:", error);
    return NextResponse.json(
      { error: "Failed to fetch shoe assignments" },
      { status: 500 },
    );
  }
}
