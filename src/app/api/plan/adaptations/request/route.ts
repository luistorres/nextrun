import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { adaptations, trainingPlans } from "@/lib/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { subHours } from "date-fns";
import { adaptPlan } from "@/lib/plan-engine/adapter";
import type { AdaptPlanResult } from "@/lib/plan-engine/adapter";

export const maxDuration = 60;

const RequestSchema = z.object({
  context: z
    .string()
    .trim()
    .min(1, "Context cannot be empty")
    .max(500, "Context must be under 500 characters")
    .optional(),
});

/** Simple string hash to produce a stable int for pg_advisory_lock */
function hashString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  }
  return hash;
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    // Find active plan
    const plan = await db.query.trainingPlans.findFirst({
      where: and(
        eq(trainingPlans.userId, session.user.id),
        eq(trainingPlans.status, "active"),
      ),
      columns: { id: true },
    });

    if (!plan) {
      return NextResponse.json(
        { error: "No active plan found" },
        { status: 404 },
      );
    }

    // Acquire advisory lock to prevent concurrent user-requested adaptations
    // for the same plan. pg_try_advisory_lock returns false if already held.
    const lockKey = hashString(`user_adapt:${plan.id}`);
    const lockResult = await db.execute(
      sql`SELECT pg_try_advisory_lock(${lockKey}) as acquired`,
    );
    const acquired = (lockResult as unknown as { acquired: boolean }[])[0]?.acquired;

    if (!acquired) {
      return NextResponse.json(
        { error: "A plan review is already in progress" },
        { status: 409 },
      );
    }

    let result: AdaptPlanResult;
    try {
      // Rate limit: max 1 user-requested adaptation per 6 hours per plan
      const sixHoursAgo = subHours(new Date(), 6);
      const [recent] = await db
        .select({ id: adaptations.id })
        .from(adaptations)
        .where(
          and(
            eq(adaptations.planId, plan.id),
            eq(adaptations.triggerType, "user_request"),
            gte(adaptations.createdAt, sixHoursAgo),
          ),
        )
        .limit(1);

      if (recent) {
        return NextResponse.json(
          { error: "You can request a plan review once every 6 hours" },
          { status: 429 },
        );
      }

      result = await adaptPlan(db, session.user.id, plan.id, {
        trigger: "user_request",
        userContext: parsed.data.context,
      });
    } finally {
      await db.execute(sql`SELECT pg_advisory_unlock(${lockKey})`);
    }

    if (!result.adapted) {
      return NextResponse.json({
        adapted: false,
        message: result.explanation,
      });
    }

    return NextResponse.json({
      adapted: true,
      adaptationId: result.adaptationId,
      message: result.explanation,
      changes: result.changes,
    });
  } catch (error) {
    console.error("Request adaptation error:", error);
    return NextResponse.json(
      { error: "Failed to process adaptation request" },
      { status: 500 },
    );
  }
}
