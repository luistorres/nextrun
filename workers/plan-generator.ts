/**
 * BullMQ worker for AI training plan generation.
 *
 * Processes jobs from the plan-generation queue by invoking the
 * plan generation orchestrator. Handles errors and updates job progress.
 */

import { Worker } from "bullmq";
import { createRedisConnection } from "../src/lib/queue/connection";
import { QUEUE_NAMES } from "../src/lib/queue/queues";
import type { PlanGenerationJobData } from "../src/lib/queue/job-types";
import { logger } from "./shared/logger";
import { withErrorHandling } from "./shared/error-handler";
import { db } from "./shared/db";
import { generatePlan } from "../src/lib/plan-engine/generator";

export const planGeneratorWorker = new Worker<PlanGenerationJobData>(
  QUEUE_NAMES.PLAN_GENERATION,
  withErrorHandling(QUEUE_NAMES.PLAN_GENERATION, async (job) => {
    const { userId, goalId, isRefinement } = job.data;

    logger.info("Plan generation job started", {
      queue: QUEUE_NAMES.PLAN_GENERATION,
      jobId: job.id,
      userId,
      goalId,
      isRefinement,
    });

    await job.updateProgress(10);

    // Run the plan generation orchestrator
    const result = await generatePlan(db, userId, goalId);

    await job.updateProgress(100);

    logger.info("Plan generation completed", {
      queue: QUEUE_NAMES.PLAN_GENERATION,
      jobId: job.id,
      userId,
      goalId,
      planId: result.planId,
      totalWeeks: result.totalWeeks,
      workoutCount: result.workoutCount,
      warnings: result.warnings,
    });

    return result;
  }),
  {
    connection: createRedisConnection(),
    concurrency: 1,
  },
);
