import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { trainingPlans } from "@/lib/db/schema";
import { enqueuePlanReview } from "@/lib/queue/producer";

/**
 * Call only when the athlete is present (app visit, manual sync). A review is
 * due when an activity arrived since the last one or the last one is over 20h
 * old; the row lock makes concurrent visits claim it at most once.
 */
export async function requestPlanReview(
  userId: string,
): Promise<{ queued: boolean }> {
  const claimed = await db.transaction(async (tx) => {
    const [plan] = await tx
      .select({
        id: trainingPlans.id,
        activityId: trainingPlans.unreviewedActivityId,
      })
      .from(trainingPlans)
      .where(
        and(
          eq(trainingPlans.userId, userId),
          eq(trainingPlans.status, "active"),
          or(
            isNull(trainingPlans.reviewRequestedAt),
            lt(trainingPlans.reviewRequestedAt, sql`now() - interval '20 hours'`),
            isNotNull(trainingPlans.unreviewedActivityId),
          ),
        ),
      )
      .limit(1)
      .for("update");

    if (!plan) return null;

    await tx
      .update(trainingPlans)
      .set({ reviewRequestedAt: new Date(), unreviewedActivityId: null })
      .where(eq(trainingPlans.id, plan.id));

    return plan;
  });

  if (!claimed) return { queued: false };

  await enqueuePlanReview({
    userId,
    planId: claimed.id,
    activityId: claimed.activityId,
  });
  return { queued: true };
}

export async function markActivityForReview(
  planId: string,
  activityId: string,
): Promise<void> {
  await db
    .update(trainingPlans)
    .set({ unreviewedActivityId: activityId })
    .where(eq(trainingPlans.id, planId));
}
