import type { JobsOptions } from "bullmq";
import {
  backfillQueue,
  planGenerationQueue,
  eventAdaptationQueue,
  garminSyncQueue,
  webhookProcessingQueue,
  fitDownloadQueue,
  connectBackfillQueue,
} from "./queues";
import type {
  BackfillJobData,
  PlanGenerationJobData,
  EventAdaptationJobData,
  GarminSyncJobData,
  WebhookProcessingJobData,
  FitDownloadPingJobData,
  FitDownloadConnectJobData,
  ConnectBackfillJobData,
} from "./job-types";

// ---------------------------------------------------------------------------
// Shared default job options
// ---------------------------------------------------------------------------

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 30_000, // 30 s → 60 s → 120 s
  },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
};

// ---------------------------------------------------------------------------
// Producer helpers — call these from API routes / webhooks
// ---------------------------------------------------------------------------

/** Enqueue a historical Garmin data backfill job. */
export async function enqueueBackfill(data: BackfillJobData) {
  return backfillQueue.add("backfill", data, {
    ...DEFAULT_JOB_OPTIONS,
    jobId: `backfill-${data.userId}-${data.chunkIndex}`,
  });
}

/** Enqueue the initial 90-day import after first Garmin sign-in. */
export async function enqueueConnectBackfill(data: ConnectBackfillJobData) {
  const jobId = `connect-backfill-${data.userId}`;
  // A stale terminal job under this id would make add() a silent no-op and
  // block retries forever. Remove only jobs that will never run again
  // (completed/failed, or "unknown" = orphaned hash in no list) so an
  // in-flight run keeps deduping; lookup/remove errors fall through to add().
  try {
    const existing = await connectBackfillQueue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === "completed" || state === "failed" || state === "unknown") {
        await existing.remove();
      }
    }
  } catch {
    // add() below still dedupes or enqueues correctly
  }
  return connectBackfillQueue.add("connect-backfill", data, {
    ...DEFAULT_JOB_OPTIONS,
    jobId,
  });
}

/** Enqueue an AI training plan generation job. */
export async function enqueuePlanGeneration(data: PlanGenerationJobData) {
  const jobId = `plan-gen-${data.userId}-${data.goalId}`;
  // A stale completed/failed job under this id would make add() a silent
  // no-op, blocking regeneration forever. Only terminal jobs are removed:
  // blind-removing a waiting/delayed job would lose it if add() then throws,
  // and add() dedupes against live jobs anyway.
  const existing = await planGenerationQueue.getJob(jobId).catch(() => null);
  if (existing) {
    const state = await existing.getState().catch(() => "unknown");
    if (state === "completed" || state === "failed") {
      await planGenerationQueue.remove(jobId).catch(() => {});
    }
  }
  return planGenerationQueue.add("plan-generation", data, {
    ...DEFAULT_JOB_OPTIONS,
    jobId,
  });
}

/** Enqueue a plan review; callers claim it in the DB first (requestPlanReview). */
export async function enqueuePlanReview(data: EventAdaptationJobData) {
  return eventAdaptationQueue.add("event-adaptation", data, {
    ...DEFAULT_JOB_OPTIONS,
    jobId: `plan-review-${data.planId}-${Date.now()}`,
  });
}

/** Enqueue a Garmin Training API sync job. */
export async function enqueueGarminSync(data: GarminSyncJobData) {
  return garminSyncQueue.add("garmin-sync", data, {
    ...DEFAULT_JOB_OPTIONS,
    jobId: `garmin-sync-${data.userId}-${data.action}-${Date.now()}`,
  });
}

/** Enqueue heavy webhook post-processing. */
export async function enqueueWebhookProcessing(
  data: WebhookProcessingJobData,
) {
  return webhookProcessingQueue.add("webhook-processing", data, {
    ...DEFAULT_JOB_OPTIONS,
  });
}

// ---------------------------------------------------------------------------
// FIT file downloads — deliberately NOT the default retry policy.
//
// Garmin activity-file callback URLs are valid for ~24h and Garmin never
// re-pings, so the default 3-attempt policy would give up after ~3.5 minutes
// and lose the file forever. Instead we retry aggressively inside the window:
//
//   attempts: 8, exponential backoff starting at 60s
//   delays: 60s, 120s, 240s, 480s, 960s, 1920s, 3840s
//   total:  ~7,620s ≈ 2.1h from first attempt to the 8th — well inside 24h,
//   leaving the hourly reconciliation cron plenty of window to re-enqueue
//   rows that exhausted their BullMQ job (e.g. a long Garmin outage).
//
// HTTP 410 ("gone") is terminal and handled in the worker without rethrowing,
// so it never consumes these retries.
// ---------------------------------------------------------------------------

const FIT_DOWNLOAD_JOB_OPTIONS: JobsOptions = {
  attempts: 8,
  backoff: {
    type: "exponential",
    delay: 60_000,
  },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
};

/** Enqueue a Garmin activity-file download job (official ping path). */
export async function enqueueFitDownload(
  data: FitDownloadPingJobData,
  options?: { dedupeSuffix?: string },
) {
  // Default jobId dedupes the initial webhook enqueue per ledger row; the
  // reconciliation cron passes a suffix so re-enqueues get a fresh job.
  const jobId = options?.dedupeSuffix
    ? `fit-download-${data.ledgerId}-${options.dedupeSuffix}`
    : `fit-download-${data.ledgerId}`;

  return fitDownloadQueue.add("fit-download", data, {
    ...FIT_DOWNLOAD_JOB_OPTIONS,
    jobId,
  });
}

/**
 * Enqueue a FIT download via the unofficial Garmin Connect client.
 *
 * Unlike the ping path there is no 24h callback window — the download URL is
 * permanent — so the standard retry policy applies and no ledger row exists.
 * The jobId dedupes per internal activity (re-imports won't re-enqueue while
 * a previous job is still pending).
 */
export async function enqueueConnectFitDownload(
  data: Omit<FitDownloadConnectJobData, "source">,
) {
  return fitDownloadQueue.add(
    "fit-download-connect",
    { ...data, source: "connect" satisfies FitDownloadConnectJobData["source"] },
    {
      ...DEFAULT_JOB_OPTIONS,
      jobId: `fit-download-connect-${data.activityId}`,
    },
  );
}
