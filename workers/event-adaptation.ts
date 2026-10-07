/**
 * Plan review worker. Jobs come only from requestPlanReview, i.e. while the
 * athlete is using the app, so background imports never spend model calls.
 */

import { Worker } from "bullmq";
import { eq } from "drizzle-orm";
import { createRedisConnection } from "../src/lib/queue/connection";
import { QUEUE_NAMES } from "../src/lib/queue/queues";
import type { EventAdaptationJobData } from "../src/lib/queue/job-types";
import { db } from "./shared/db";
import { logger } from "./shared/logger";
import { withErrorHandling } from "./shared/error-handler";
import { trainingPlans, activities } from "../src/lib/db/schema";
import { adaptPlan } from "../src/lib/plan-engine/adapter";
import { updateResponsePatterns } from "../src/lib/metrics/response-patterns";

export const eventAdaptationWorker = new Worker<EventAdaptationJobData>(
  QUEUE_NAMES.EVENT_ADAPTATION,
  withErrorHandling(QUEUE_NAMES.EVENT_ADAPTATION, async (job) => {
    const { userId, planId, activityId } = job.data;

    logger.info("Event adaptation job received", {
      queue: QUEUE_NAMES.EVENT_ADAPTATION,
      jobId: job.id,
      userId,
      planId,
      activityId,
    });

    // ── 1. Verify the plan is still active ────────────────────────────
    const [plan] = await db
      .select({ id: trainingPlans.id, status: trainingPlans.status })
      .from(trainingPlans)
      .where(eq(trainingPlans.id, planId))
      .limit(1);

    if (!plan || plan.status !== "active") {
      logger.info("Skipping event adaptation — plan not active", {
        queue: QUEUE_NAMES.EVENT_ADAPTATION,
        jobId: job.id,
        userId,
        planId,
        planStatus: plan?.status ?? "not found",
      });
      return;
    }

    // ── 2. Check if the triggering activity was unplanned ─────────────
    let hasUnplannedActivity = false;

    if (activityId) {
      const [activity] = await db
        .select({ wasPlanned: activities.wasPlanned })
        .from(activities)
        .where(eq(activities.id, activityId))
        .limit(1);

      hasUnplannedActivity = activity ? !activity.wasPlanned : false;
    }

    // Determine the trigger type
    const trigger = hasUnplannedActivity
      ? "unplanned_activity" as const
      : "weekly_review" as const;

    try {
      await updateResponsePatterns(db, userId);
    } catch (err) {
      logger.warn("Failed to update response patterns", {
        queue: QUEUE_NAMES.EVENT_ADAPTATION,
        jobId: job.id,
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // ── 3. Run the adaptation orchestrator ────────────────────────────
    const result = await adaptPlan(db, userId, planId, {
      trigger,
      hasUnplannedActivity,
    });

    if (result.adapted) {
      logger.info("Event adaptation generated", {
        queue: QUEUE_NAMES.EVENT_ADAPTATION,
        jobId: job.id,
        userId,
        planId,
        activityId,
        adaptationId: result.adaptationId,
        severity: result.severity,
        changeCount: result.changes.length,
        trigger,
      });
    } else {
      logger.info("Event adaptation evaluated — no changes needed", {
        queue: QUEUE_NAMES.EVENT_ADAPTATION,
        jobId: job.id,
        userId,
        planId,
        activityId,
        reason: result.explanation,
      });
    }
  }),
  {
    connection: createRedisConnection(),
    concurrency: 1,
  },
);
