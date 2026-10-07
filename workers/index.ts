// Load .env before anything else — tsx doesn't auto-load env like Next.js does
import "dotenv/config";

import { registerGlobalErrorHandlers } from "./shared/error-handler";
import { logger } from "./shared/logger";

// Register global error handlers before importing workers
registerGlobalErrorHandlers();

// ---------------------------------------------------------------------------
// Import all workers — each creates its own BullMQ Worker instance on import
// ---------------------------------------------------------------------------
import { backfillWorker } from "./backfill-processor";
import { planGeneratorWorker } from "./plan-generator";
import { eventAdaptationWorker } from "./event-adaptation";
import { garminSyncWorker } from "./garmin-sync";
import { fitDownloadWorker, FIT_RECONCILE_JOB_NAME } from "./fit-download";
import {
  connectBackfillWorker,
  CONNECT_SYNC_SWEEP_JOB_NAME,
} from "./connect-backfill";

// We also need queues to register the cron repeatable jobs
import {
  weeklyAdaptationQueue,
  fitDownloadQueue,
  connectBackfillQueue,
} from "../src/lib/queue/queues";

const workers = [
  backfillWorker,
  planGeneratorWorker,
  eventAdaptationWorker,
  garminSyncWorker,
  fitDownloadWorker,
  connectBackfillWorker,
];

// ---------------------------------------------------------------------------
// Cron jobs. upsertJobScheduler is idempotent, so this runs on every startup.
// ---------------------------------------------------------------------------
async function registerCronJobs(): Promise<void> {
  // Adaptation reviews now run when the athlete opens the app. The old daily
  // scheduler lives in Redis, so deleting its registration isn't enough.
  // ponytail: remove this and weeklyAdaptationQueue after one production boot.
  // A cleanup failure must never block startup: web and worker share a machine.
  try {
    await weeklyAdaptationQueue.removeJobScheduler("weekly-adaptation-cron");
  } catch (err) {
    logger.warn("Could not remove the retired weekly-adaptation scheduler", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // FIT download reconciliation: hourly safety net that re-enqueues ledger
  // rows stuck in received/enqueued (Garmin never re-pings and callback URLs
  // die after 24h, so a lost job means a lost file unless we catch it here).
  await fitDownloadQueue.upsertJobScheduler(
    "fit-reconcile-cron",
    {
      pattern: "0 * * * *", // Every hour, on the hour
    },
    {
      name: FIT_RECONCILE_JOB_NAME,
      data: {
        // Sentinel values — the reconcile job scans the ledger itself.
        ledgerId: "",
        userId: "",
        summaryId: "",
      },
    },
  );

  logger.info("Cron job registered", {
    scheduler: "fit-reconcile-cron",
    pattern: "0 * * * * (hourly)",
  });

  // Minute 30 keeps it off the FIT reconcile tick and lands the 05:30 run
  // before the 06:00 adaptation review.
  await connectBackfillQueue.upsertJobScheduler(
    "connect-sync-sweep-cron",
    {
      pattern: "30 * * * *",
    },
    {
      name: CONNECT_SYNC_SWEEP_JOB_NAME,
      data: { userId: "" },
    },
  );

  logger.info("Cron job registered", {
    scheduler: "connect-sync-sweep-cron",
    pattern: "30 * * * * (hourly)",
  });
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
async function shutdown(signal: string): Promise<void> {
  logger.info("Shutdown signal received, closing workers...", { signal });

  // Close all workers (waits for in-progress jobs to finish)
  await Promise.all(workers.map((w) => w.close()));

  // Close the queue connections used for cron registration
  await weeklyAdaptationQueue.close();
  await fitDownloadQueue.close();
  await connectBackfillQueue.close();

  logger.info("All workers shut down cleanly");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  logger.info("Worker process starting", {
    workers: workers.map((w) => w.name),
    pid: process.pid,
  });

  await registerCronJobs();

  logger.info("All workers running and ready to process jobs");
}

main().catch((err) => {
  logger.error("Failed to start worker process", {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exit(1);
});
