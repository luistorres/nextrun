import { Queue } from "bullmq";
import { createRedisConnection } from "./connection";
import type {
  BackfillJobData,
  PlanGenerationJobData,
  WeeklyAdaptationJobData,
  EventAdaptationJobData,
  GarminSyncJobData,
  WebhookProcessingJobData,
  FitDownloadJobData,
  ConnectBackfillJobData,
} from "./job-types";

// ---------------------------------------------------------------------------
// Queue name constants
// ---------------------------------------------------------------------------

export const QUEUE_NAMES = {
  BACKFILL: "backfill",
  PLAN_GENERATION: "plan-generation",
  WEEKLY_ADAPTATION: "weekly-adaptation",
  EVENT_ADAPTATION: "event-adaptation",
  GARMIN_SYNC: "garmin-sync",
  WEBHOOK_PROCESSING: "webhook-processing",
  FIT_DOWNLOAD: "fit-download",
  CONNECT_BACKFILL: "connect-backfill",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// ---------------------------------------------------------------------------
// Queue instances
//
// Each queue gets its own Redis connection (BullMQ requirement).
// ---------------------------------------------------------------------------

export const backfillQueue = new Queue<BackfillJobData>(QUEUE_NAMES.BACKFILL, {
  connection: createRedisConnection(),
});

export const planGenerationQueue = new Queue<PlanGenerationJobData>(
  QUEUE_NAMES.PLAN_GENERATION,
  { connection: createRedisConnection() },
);

export const weeklyAdaptationQueue = new Queue<WeeklyAdaptationJobData>(
  QUEUE_NAMES.WEEKLY_ADAPTATION,
  { connection: createRedisConnection() },
);

export const eventAdaptationQueue = new Queue<EventAdaptationJobData>(
  QUEUE_NAMES.EVENT_ADAPTATION,
  { connection: createRedisConnection() },
);

export const garminSyncQueue = new Queue<GarminSyncJobData>(
  QUEUE_NAMES.GARMIN_SYNC,
  { connection: createRedisConnection() },
);

export const webhookProcessingQueue = new Queue<WebhookProcessingJobData>(
  QUEUE_NAMES.WEBHOOK_PROCESSING,
  { connection: createRedisConnection() },
);

export const fitDownloadQueue = new Queue<FitDownloadJobData>(
  QUEUE_NAMES.FIT_DOWNLOAD,
  { connection: createRedisConnection() },
);

export const connectBackfillQueue = new Queue<ConnectBackfillJobData>(
  QUEUE_NAMES.CONNECT_BACKFILL,
  { connection: createRedisConnection() },
);
