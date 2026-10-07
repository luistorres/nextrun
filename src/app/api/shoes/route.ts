import { NextResponse } from "next/server";
import { and, count, eq, gte, isNotNull, max, sum } from "drizzle-orm";
import { z } from "zod/v4";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { activities, shoes, SHOE_CATEGORIES } from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  brand: z.string().trim().max(100).nullish(),
  model: z.string().trim().max(100).nullish(),
  category: z.enum(SHOE_CATEGORIES),
  startingKm: z.number().min(0).max(5000).optional(),
});

const COVERAGE_WINDOW_DAYS = 30;

// ---------------------------------------------------------------------------
// GET /api/shoes — List shoes with computed mileage, usage, and coverage
// ---------------------------------------------------------------------------
// Mileage = startingKm + sum(distanceMeters)/1000 of manually assigned
// activities. Computed at read time, never stored (Garmin's partner API does
// not expose gear, so assignment is manual and the odometer is approximate).

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    const windowStart = new Date(
      Date.now() - COVERAGE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );

    const [userShoes, totals, recents, [coverage]] = await Promise.all([
      // All shoes (active + retired)
      db.select().from(shoes).where(eq(shoes.userId, userId)),
      // All-time aggregates per assigned shoe
      db
        .select({
          shoeId: activities.shoeId,
          activityCount: count(activities.id),
          totalMeters: sum(activities.distanceMeters),
          lastUsedAt: max(activities.startTime),
        })
        .from(activities)
        .where(
          and(eq(activities.userId, userId), isNotNull(activities.shoeId)),
        )
        .groupBy(activities.shoeId),
      // Last-30-day aggregates per assigned shoe (runs only)
      db
        .select({
          shoeId: activities.shoeId,
          runCount: count(activities.id),
          totalMeters: sum(activities.distanceMeters),
        })
        .from(activities)
        .where(
          and(
            eq(activities.userId, userId),
            isNotNull(activities.shoeId),
            eq(activities.activityType, "run"),
            gte(activities.startTime, windowStart),
          ),
        )
        .groupBy(activities.shoeId),
      // Coverage: how many recent runs have a shoe assigned at all
      db
        .select({
          totalRuns: count(activities.id),
          assignedRuns: count(activities.shoeId),
        })
        .from(activities)
        .where(
          and(
            eq(activities.userId, userId),
            eq(activities.activityType, "run"),
            gte(activities.startTime, windowStart),
          ),
        ),
    ]);

    const totalsByShoe = new Map(totals.map((t) => [t.shoeId, t]));
    const recentsByShoe = new Map(recents.map((r) => [r.shoeId, r]));

    const formatted = userShoes
      .map((shoe) => {
        const total = totalsByShoe.get(shoe.id);
        const recent = recentsByShoe.get(shoe.id);
        const startingKm = Number(shoe.startingKm);
        return {
          id: shoe.id,
          name: shoe.name,
          brand: shoe.brand,
          model: shoe.model,
          category: shoe.category,
          startingKm,
          retiredAt: shoe.retiredAt?.toISOString() ?? null,
          createdAt: shoe.createdAt.toISOString(),
          totalKm: startingKm + Number(total?.totalMeters ?? 0) / 1000,
          activityCount: total?.activityCount ?? 0,
          lastUsedAt: total?.lastUsedAt?.toISOString() ?? null,
          recentKm: Number(recent?.totalMeters ?? 0) / 1000,
          recentRunCount: recent?.runCount ?? 0,
        };
      })
      .sort((a, b) => b.totalKm - a.totalKm);

    return NextResponse.json({
      shoes: formatted,
      coverage: {
        windowDays: COVERAGE_WINDOW_DAYS,
        totalRuns: coverage?.totalRuns ?? 0,
        assignedRuns: coverage?.assignedRuns ?? 0,
      },
    });
  } catch (error) {
    console.error("List shoes error:", error);
    return NextResponse.json(
      { error: "Failed to fetch shoes" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/shoes — Register a new shoe
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const result = createSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error.issues[0].message },
        { status: 400 },
      );
    }

    const { name, brand, model, category, startingKm } = result.data;

    const [created] = await db
      .insert(shoes)
      .values({
        userId: session.user.id,
        name,
        brand: brand || null,
        model: model || null,
        category,
        startingKm: String(startingKm ?? 0),
      })
      .returning();

    return NextResponse.json(
      {
        shoe: {
          id: created.id,
          name: created.name,
          brand: created.brand,
          model: created.model,
          category: created.category,
          startingKm: Number(created.startingKm),
          retiredAt: null,
          createdAt: created.createdAt.toISOString(),
          totalKm: Number(created.startingKm),
          activityCount: 0,
          lastUsedAt: null,
          recentKm: 0,
          recentRunCount: 0,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Create shoe error:", error);
    return NextResponse.json(
      { error: "Failed to create shoe" },
      { status: 500 },
    );
  }
}
