/**
 * BullMQ worker for Garmin Connect imports via the unofficial client:
 *
 * - The initial 90-day import after first sign-in, which drives
 *   garmin_connections.backfill_status so the onboarding "Analyzing" polling
 *   resolves.
 * - An hourly sweep that pulls recent days for every connected user. The
 *   unofficial client gets no push webhooks, so without it data only arrives
 *   when the athlete presses Sync.
 */

import { Worker } from "bullmq";
import { eq } from "drizzle-orm";
import { createRedisConnection } from "../src/lib/queue/connection";
import { QUEUE_NAMES } from "../src/lib/queue/queues";
import type { ConnectBackfillJobData } from "../src/lib/queue/job-types";
import { logger } from "./shared/logger";
import { withErrorHandling } from "./shared/error-handler";
import { db } from "./shared/db";
import { garminConnections } from "../src/lib/db/schema";
import {
  getAuthenticatedClient,
  persistTokens,
} from "../src/lib/garmin/connect-client";
import { importRecentData } from "../src/lib/garmin/connect-importer";
import { syncRecentData } from "../src/lib/garmin/sync-recent";

const BACKFILL_DAYS = 90;
// Covers sleep and HRV that Garmin finalises the morning after, plus a
// missed sweep or two.
const SWEEP_DAYS = 3;

export const CONNECT_SYNC_SWEEP_JOB_NAME = "connect-sync-sweep";

// Per-user failures are logged and skipped: one expired session must not stop
// the others, and a failed pull never touches the stored connection.
async function sweepConnectedUsers() {
  const connections = await db
    .select({ userId: garminConnections.userId })
    .from(garminConnections)
    .where(eq(garminConnections.backfillStatus, "completed"));

  let synced = 0;
  let failed = 0;
  for (const { userId } of connections) {
    try {
      const client = await getAuthenticatedClient(userId);
      if (!client) continue;
      const result = await syncRecentData(client, userId, SWEEP_DAYS);
      synced++;
      logger.info("Connect sync sweep: user synced", {
        userId,
        newActivities: result.newActivities,
        dailySummaries: result.dailySummaries,
        errors: result.errors.length,
      });
    } catch (error) {
      failed++;
      logger.warn("Connect sync sweep: user failed", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { users: connections.length, synced, failed };
}

async function setStatus(
  userId: string,
  status: string,
  extra: Partial<typeof garminConnections.$inferInsert> = {},
): Promise<void> {
  await db
    .update(garminConnections)
    .set({ backfillStatus: status, ...extra })
    .where(eq(garminConnections.userId, userId));
}

export const connectBackfillWorker = new Worker<ConnectBackfillJobData>(
  QUEUE_NAMES.CONNECT_BACKFILL,
  withErrorHandling(QUEUE_NAMES.CONNECT_BACKFILL, async (job) => {
    if (job.name === CONNECT_SYNC_SWEEP_JOB_NAME) {
      const summary = await sweepConnectedUsers();
      logger.info("Connect sync sweep completed", {
        queue: QUEUE_NAMES.CONNECT_BACKFILL,
        jobId: job.id,
        ...summary,
      });
      return summary;
    }

    const { userId } = job.data;

    logger.info("Connect backfill started", {
      queue: QUEUE_NAMES.CONNECT_BACKFILL,
      jobId: job.id,
      userId,
    });

    const client = await getAuthenticatedClient(userId);
    if (!client) {
      logger.warn("Connect backfill skipped — no Garmin connection", {
        userId,
      });
      return { skipped: true };
    }

    await setStatus(userId, "in_progress", {
      backfillRequestedAt: new Date(),
    });

    try {
      const result = await importRecentData(client, userId, BACKFILL_DAYS);
      await persistTokens(userId, client);
      await setStatus(userId, "completed", {
        backfillCompletedAt: new Date(),
        lastSyncAt: new Date(),
      });

      logger.info("Connect backfill completed", {
        queue: QUEUE_NAMES.CONNECT_BACKFILL,
        jobId: job.id,
        userId,
        activities: result.activities,
        newActivities: result.newActivities,
        dailySummaries: result.dailySummaries,
        errors: result.errors.length,
      });

      return {
        activities: result.activities,
        newActivities: result.newActivities,
      };
    } catch (error) {
      // Failed status lets a later login re-enqueue instead of wedging on
      // in_progress forever
      await setStatus(userId, "failed");
      throw error;
    }
  }),
  {
    connection: createRedisConnection(),
    concurrency: 1,
  },
);
