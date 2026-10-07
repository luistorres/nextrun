// ─── FIT Download Worker ─────────────────────────────────────────────────────
//
// BullMQ worker that downloads Garmin activity files (FIT/TCX/GPX) announced
// via the activity-files ping webhook. Each job references a row in the
// garmin_file_events ledger, which is the source of truth:
//
//   received → enqueued → downloaded
//                       ↘ failed_terminal (expired / 410 / unrecoverable)
//
// Hard constraint: the callbackURL is only valid for ~24h, Garmin never
// re-pings, and a successful download followed by a re-download returns 410.
// So this queue uses an aggressive retry policy (8 attempts, exponential
// backoff from 60s — see FIT_DOWNLOAD_JOB_OPTIONS in src/lib/queue/producer.ts)
// and treats 410 as terminal without consuming retries.
//
// After a successful download the FIT binary is decoded in-process
// (best-effort: laps, running dynamics, lactate threshold — see
// src/lib/garmin/fit-decoder.ts). Decoding failures only log a warning and
// never fail the job: capturing the bytes inside the 24h window is the only
// thing that cannot be done later, decoding is always retroactive
// (see decodeStoredFitFile below).

// The PRIMARY ingestion path today is the unofficial Garmin Connect client
// (credential flow, no partner license): the connect importer enqueues a
// {source:"connect"} job variant after storing a new run activity, and
// processConnectDownloadJob downloads the original FIT (a permanent URL —
// no 24h window, no ledger) via /download-service. The official ping path
// above is kept intact but dormant until partner credentials exist.

import { Worker } from "bullmq";
import { and, eq, inArray, lt } from "drizzle-orm";
import { createRedisConnection } from "../src/lib/queue/connection";
import { QUEUE_NAMES } from "../src/lib/queue/queues";
import type {
  FitDownloadJobData,
  FitDownloadPingJobData,
  FitDownloadConnectJobData,
} from "../src/lib/queue/job-types";
import { enqueueFitDownload } from "../src/lib/queue/producer";
import { logger } from "./shared/logger";
import { withErrorHandling } from "./shared/error-handler";
import { db } from "./shared/db";
import {
  garminFileEvents,
  garminConnections,
  activities,
  activityLaps,
} from "../src/lib/db/schema";
import { decrypt, encrypt } from "../src/lib/utils/encryption";
import { refreshAccessToken } from "../src/lib/garmin/auth";
import { getStorage, buildFitFileKey } from "../src/lib/storage";
import {
  getAuthenticatedClient,
  persistTokens,
} from "../src/lib/garmin/connect-client";
import { downloadOriginalFitViaConnect } from "../src/lib/garmin/connect-fit-download";
import { decodeFitBuffer, type FitMetrics } from "../src/lib/garmin/fit-decoder";
import {
  decideFitDownloadAction,
  decideReconciliationAction,
  nextStatusForOutcome,
  MAX_FIT_DOWNLOAD_ATTEMPTS,
  type FitDownloadOutcome,
  type FitFileEventStatus,
} from "../src/lib/garmin/fit-file-ledger";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Job name used by the hourly reconciliation scheduler (see workers/index.ts) */
export const FIT_RECONCILE_JOB_NAME = "fit-reconcile";

/** Proactively refresh tokens within 7 days of expiry */
const REFRESH_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

// ─── Auth Helper ─────────────────────────────────────────────────────────────

/**
 * Get a valid OAuth access token for the user, refreshing if needed.
 * Worker-local implementation using workers/shared/db (same pattern as
 * backfill-processor). Returns null when no usable token exists.
 */
async function getAccessTokenForUser(userId: string): Promise<string | null> {
  const connection = await db
    .select({
      accessToken: garminConnections.accessToken,
      refreshToken: garminConnections.refreshToken,
      tokenExpiresAt: garminConnections.tokenExpiresAt,
    })
    .from(garminConnections)
    .where(eq(garminConnections.userId, userId))
    .then((rows) => rows[0] ?? null);

  if (!connection) {
    logger.error("No Garmin connection found for user", { userId });
    return null;
  }

  const decryptedAccessToken = decrypt(connection.accessToken);

  // Credential-flow connections (garmin-connect) store a JSON token blob that
  // cannot authenticate against the wellness-api callback URLs.
  if (decryptedAccessToken.startsWith("{")) {
    logger.warn("Credential-based Garmin connection cannot download files", {
      userId,
    });
    return null;
  }

  const needsRefresh =
    !connection.tokenExpiresAt ||
    Date.now() + REFRESH_THRESHOLD_MS >= connection.tokenExpiresAt.getTime();

  if (!needsRefresh) {
    return decryptedAccessToken;
  }

  if (!connection.refreshToken) {
    logger.warn("Token expiring but no refresh token available", { userId });
    return decryptedAccessToken;
  }

  try {
    const newTokens = await refreshAccessToken(decrypt(connection.refreshToken));

    await db
      .update(garminConnections)
      .set({
        accessToken: encrypt(newTokens.access_token),
        refreshToken: encrypt(newTokens.refresh_token),
        tokenExpiresAt: new Date(Date.now() + newTokens.expires_in * 1000),
      })
      .where(eq(garminConnections.userId, userId));

    logger.info("Token refreshed successfully", { userId });
    return newTokens.access_token;
  } catch (error) {
    logger.error("Token refresh failed, using existing token", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return decryptedAccessToken;
  }
}

// ─── Ledger Helpers ──────────────────────────────────────────────────────────

async function getLedgerRow(ledgerId: string) {
  const [row] = await db
    .select()
    .from(garminFileEvents)
    .where(eq(garminFileEvents.id, ledgerId))
    .limit(1);
  return row ?? null;
}

async function markTerminal(ledgerId: string, reason: string): Promise<void> {
  await db
    .update(garminFileEvents)
    .set({ status: "failed_terminal" satisfies FitFileEventStatus, lastError: reason })
    .where(eq(garminFileEvents.id, ledgerId));
}

// ─── Download ────────────────────────────────────────────────────────────────

/**
 * Download the file from the Garmin callback URL.
 * Authenticated with the user's OAuth bearer token (same auth as the rest of
 * the wellness API — see backfill-processor / training-api).
 */
async function downloadFile(
  callbackUrl: string,
  accessToken: string,
): Promise<{ outcome: FitDownloadOutcome; bytes?: Buffer }> {
  let response: Response;
  try {
    response = await fetch(callbackUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (error) {
    return {
      outcome: {
        kind: "transient_error",
        message: `fetch failed: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }

  if (response.status === 410) {
    // File already consumed or expired server-side — retrying can never work
    return { outcome: { kind: "gone" } };
  }

  if (!response.ok) {
    // Everything else (401 token hiccup, 429 rate limit, 5xx, even 404 while
    // the file is still materializing) is worth retrying inside the window.
    return {
      outcome: {
        kind: "transient_error",
        message: `HTTP ${response.status} from callback URL`,
      },
    };
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  return { outcome: { kind: "success" }, bytes };
}

// ─── FIT Decoding ────────────────────────────────────────────────────────────

/** Format an optional number for a Drizzle `numeric` column. */
function toNumeric(value: number | undefined): string | null {
  return value !== undefined ? String(value) : null;
}

/** Round an optional number to the nearest integer (HR columns are `integer`). */
function toInt(value: number | undefined): number | null {
  return value !== undefined ? Math.round(value) : null;
}

/**
 * Persist decoded FIT metrics: replace the activity's laps wholesale
 * (delete + insert) and update the dynamics / lactate-threshold columns.
 * Each decode is authoritative, so missing fields overwrite with null.
 */
async function persistFitMetrics(
  activityId: string,
  metrics: FitMetrics,
): Promise<void> {
  const lapRows = metrics.laps.map((lap, i) => ({
    activityId,
    // Defensive: lapIndex must be unique per activity — fall back to the
    // array position if the FIT message indexes are missing or duplicated.
    lapIndex: Number.isInteger(lap.lapIndex) ? lap.lapIndex : i,
    startTimeInSeconds: toInt(lap.startTimeInSeconds),
    totalDistanceMeters: toNumeric(lap.totalDistanceMeters),
    totalTimerTimeSeconds: toNumeric(lap.totalTimerTimeSeconds),
    avgSpeedMps: toNumeric(lap.avgSpeedMps),
    avgHeartRate: toInt(lap.avgHeartRate),
    maxHeartRate: toInt(lap.maxHeartRate),
    avgRunCadence: toNumeric(lap.avgRunCadence),
    avgPaceSecondsPerKm: toNumeric(
      lap.avgPaceSecondsPerKm !== undefined
        ? Math.round(lap.avgPaceSecondsPerKm * 10) / 10
        : undefined,
    ),
    totalAscentMeters: toNumeric(lap.totalAscentMeters),
  }));

  await db.transaction(async (tx) => {
    await tx
      .delete(activityLaps)
      .where(eq(activityLaps.activityId, activityId));
    if (lapRows.length > 0) {
      await tx.insert(activityLaps).values(lapRows);
    }
    await tx
      .update(activities)
      .set({
        avgGroundContactTimeMs: toNumeric(
          metrics.dynamics.avgGroundContactTimeMs,
        ),
        avgVerticalOscillationMm: toNumeric(
          metrics.dynamics.avgVerticalOscillationMm,
        ),
        avgVerticalRatioPct: toNumeric(metrics.dynamics.avgVerticalRatioPct),
        avgStrideLengthM: toNumeric(metrics.dynamics.avgStrideLengthM),
        lactateThresholdHeartRate: toInt(metrics.lactateThreshold.heartRateBpm),
        lactateThresholdPaceMps: toNumeric(metrics.lactateThreshold.paceMps),
        fitDecodedAt: new Date(),
      })
      .where(eq(activities.id, activityId));
  });
}

/**
 * Best-effort in-process decode after a successful download. Never throws:
 * the raw file is already stored, so decode failures only log a warning and
 * the metrics can be recovered later via decodeStoredFitFile.
 */
async function tryDecodeFitBytes(
  activityId: string,
  bytes: Buffer,
  context: Record<string, unknown>,
): Promise<void> {
  try {
    const metrics = decodeFitBuffer(bytes);
    await persistFitMetrics(activityId, metrics);
    logger.info("FIT file decoded", {
      ...context,
      activityId,
      laps: metrics.laps.length,
    });
  } catch (error) {
    logger.warn("FIT decode failed (file stored, decode is retroactive)", {
      ...context,
      activityId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Decode a previously stored FIT file for an activity (backfill helper for
 * files downloaded before decoding existed, or whose decode failed).
 * Returns true when metrics were decoded and persisted.
 */
export async function decodeStoredFitFile(activityId: string): Promise<boolean> {
  const [activity] = await db
    .select({ id: activities.id, fitFilePath: activities.fitFilePath })
    .from(activities)
    .where(eq(activities.id, activityId))
    .limit(1);

  if (!activity?.fitFilePath) {
    logger.warn("decodeStoredFitFile: no stored file for activity", {
      activityId,
    });
    return false;
  }

  // Only FIT binaries are decodable (the pipeline also stores TCX/GPX).
  if (!activity.fitFilePath.toLowerCase().endsWith(".fit")) {
    logger.warn("decodeStoredFitFile: stored file is not FIT", {
      activityId,
      fitFilePath: activity.fitFilePath,
    });
    return false;
  }

  const bytes = await getStorage().get(activity.fitFilePath);
  if (!bytes) {
    logger.warn("decodeStoredFitFile: stored file missing from storage", {
      activityId,
      fitFilePath: activity.fitFilePath,
    });
    return false;
  }

  try {
    const metrics = decodeFitBuffer(bytes);
    await persistFitMetrics(activityId, metrics);
    logger.info("Stored FIT file decoded", {
      activityId,
      laps: metrics.laps.length,
    });
    return true;
  } catch (error) {
    logger.warn("decodeStoredFitFile: decode failed", {
      activityId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

// ─── Connect (unofficial) Job Processor ──────────────────────────────────────

/**
 * Download the original FIT for an activity via the unofficial Garmin
 * Connect client (credential flow). Enqueued by the connect importer after
 * a new run activity is stored.
 *
 * Differences from the ping path:
 * - No 24h expiry: the download URL is permanent, so the standard 3-attempt
 *   retry policy applies and no ledger row is involved.
 * - The activity row always exists (the importer created it), so the file is
 *   linked and decoded in the same job. FIT-derived laps replace any laps
 *   previously imported from the splits-JSON endpoint (delete + insert).
 */
async function processConnectDownloadJob(
  data: FitDownloadConnectJobData,
): Promise<void> {
  const { userId, activityId, garminActivityId } = data;

  const [activity] = await db
    .select({
      id: activities.id,
      fitFilePath: activities.fitFilePath,
      fitDecodedAt: activities.fitDecodedAt,
    })
    .from(activities)
    .where(eq(activities.id, activityId))
    .limit(1);

  if (!activity) {
    logger.warn("Activity row not found, skipping connect FIT download", {
      activityId,
      garminActivityId,
    });
    return;
  }

  // Idempotency: re-runs of an already-captured activity only need a decode.
  if (activity.fitFilePath) {
    if (!activity.fitDecodedAt) {
      await decodeStoredFitFile(activityId);
    }
    return;
  }

  const client = await getAuthenticatedClient(userId);
  if (!client) {
    // No stored credential tokens — can't recover by retrying.
    logger.warn("No usable Garmin Connect client for FIT download", {
      userId,
      activityId,
    });
    return;
  }

  // Throws on HTTP/network errors → BullMQ retries (standard policy).
  const fitBytes = await downloadOriginalFitViaConnect(client, garminActivityId);

  // Tokens may have been refreshed by the library during the request.
  try {
    await persistTokens(userId, client);
  } catch {
    // Non-fatal — next login/sync will refresh them again
  }

  if (!fitBytes) {
    // No original FIT exists (manual/imported activity) — permanent, no retry.
    logger.info("No original FIT file for activity, skipping", {
      userId,
      activityId,
      garminActivityId,
    });
    return;
  }

  const key = buildFitFileKey(userId, garminActivityId, "FIT");
  const storedPath = await getStorage().put(key, fitBytes);

  await db
    .update(activities)
    .set({ fitFilePath: storedPath })
    .where(eq(activities.id, activityId));

  logger.info("FIT file downloaded via Garmin Connect and stored", {
    userId,
    activityId,
    garminActivityId,
    storedPath,
    sizeBytes: fitBytes.length,
  });

  await tryDecodeFitBytes(activityId, fitBytes, {
    source: "connect",
    userId,
    garminActivityId,
  });
}

// ─── Ping (official) Job Processor ──────────────────────────────────────────

async function processDownloadJob(data: FitDownloadPingJobData): Promise<void> {
  const { ledgerId, userId, summaryId } = data;

  const row = await getLedgerRow(ledgerId);
  if (!row) {
    logger.warn("Ledger row not found, skipping", { ledgerId, summaryId });
    return;
  }

  const decision = decideFitDownloadAction(
    {
      status: row.status as FitFileEventStatus,
      attempts: row.attempts,
      expiresAt: row.expiresAt,
    },
    new Date(),
  );

  if (decision.action === "skip") {
    logger.info("FIT download skipped", { ledgerId, reason: decision.reason });
    return;
  }

  if (decision.action === "expire") {
    await markTerminal(ledgerId, "expired");
    logger.warn("FIT download window expired", { ledgerId, summaryId, userId });
    return;
  }

  const accessToken = await getAccessTokenForUser(userId);
  if (!accessToken) {
    // No connection / unsupported auth — the callback URL can never be
    // fetched for this user, so don't burn retries.
    await markTerminal(ledgerId, "no usable Garmin OAuth token");
    return;
  }

  const { outcome, bytes } = await downloadFile(row.callbackUrl, accessToken);
  const next = nextStatusForOutcome(outcome);

  if (next.retryable) {
    // Record the failure, then rethrow so BullMQ schedules the next retry
    // (8 attempts, exponential backoff — configured at enqueue time).
    await db
      .update(garminFileEvents)
      .set({ attempts: row.attempts + 1, lastError: next.lastError })
      .where(eq(garminFileEvents.id, ledgerId));
    throw new Error(next.lastError ?? "transient download error");
  }

  if (next.status === "failed_terminal") {
    await markTerminal(ledgerId, next.lastError ?? "terminal failure");
    logger.warn("FIT download failed terminally", {
      ledgerId,
      summaryId,
      userId,
      reason: next.lastError,
    });
    return;
  }

  // Success — store the raw bytes durably, then update ledger + activity.
  const key = buildFitFileKey(userId, summaryId, row.fileType);
  const storedPath = await getStorage().put(key, bytes!);

  await db
    .update(garminFileEvents)
    .set({
      status: "downloaded" satisfies FitFileEventStatus,
      storedPath,
      downloadedAt: new Date(),
      lastError: null,
    })
    .where(eq(garminFileEvents.id, ledgerId));

  // Link the file to the activity row if the activity webhook already landed.
  // (If the activity arrives later, the ledger still holds the path.)
  let linkedActivityId: string | null = null;
  if (row.garminActivityId) {
    const linked = await db
      .update(activities)
      .set({ fitFilePath: storedPath })
      .where(
        and(
          eq(activities.userId, userId),
          eq(activities.garminActivityId, row.garminActivityId),
        ),
      )
      .returning({ id: activities.id });
    linkedActivityId = linked[0]?.id ?? null;
  }

  logger.info("FIT file downloaded and stored", {
    ledgerId,
    summaryId,
    userId,
    storedPath,
    sizeBytes: bytes!.length,
  });

  // Best-effort decode (laps + dynamics). Only FIT binaries are decodable,
  // and only when the activity row exists to attach the metrics to —
  // otherwise decoding happens retroactively via decodeStoredFitFile.
  if (linkedActivityId && row.fileType.toUpperCase() === "FIT") {
    await tryDecodeFitBytes(linkedActivityId, bytes!, {
      ledgerId,
      summaryId,
      userId,
    });
  }
}

// ─── Reconciliation ──────────────────────────────────────────────────────────

/**
 * Hourly safety net (scheduled in workers/index.ts): rows stuck in
 * received/enqueued — enqueue failed after the webhook 200'd, Redis lost the
 * job, or the BullMQ job exhausted its retries during an outage — are
 * re-enqueued while their callback URL is still alive and attempts remain.
 * Expired rows are marked failed_terminal so they stop being scanned.
 */
export async function reconcileFitDownloads(): Promise<void> {
  const now = new Date();

  // 1. Expire rows whose 24h callback window has passed
  const expired = await db
    .update(garminFileEvents)
    .set({ status: "failed_terminal", lastError: "expired" })
    .where(
      and(
        inArray(garminFileEvents.status, ["received", "enqueued"]),
        lt(garminFileEvents.expiresAt, now),
      ),
    )
    .returning({ id: garminFileEvents.id });

  // 2. Re-enqueue rows that are still inside the window with budget left
  const stuck = await db
    .select()
    .from(garminFileEvents)
    .where(inArray(garminFileEvents.status, ["received", "enqueued"]));

  let reenqueued = 0;
  for (const row of stuck) {
    const action = decideReconciliationAction(
      {
        status: row.status as FitFileEventStatus,
        attempts: row.attempts,
        expiresAt: row.expiresAt,
      },
      now,
      MAX_FIT_DOWNLOAD_ATTEMPTS,
    );

    if (action !== "reenqueue") continue;

    try {
      // Unique suffix: the original jobId may still exist in a completed/
      // failed state, which would silently swallow a re-add.
      await enqueueFitDownload(
        { ledgerId: row.id, userId: row.userId, summaryId: row.summaryId },
        { dedupeSuffix: `r${now.getTime()}` },
      );
      await db
        .update(garminFileEvents)
        .set({ status: "enqueued" })
        .where(eq(garminFileEvents.id, row.id));
      reenqueued++;
    } catch (error) {
      logger.error("Failed to re-enqueue FIT download", {
        ledgerId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (expired.length > 0 || reenqueued > 0) {
    logger.info("FIT download reconciliation completed", {
      expired: expired.length,
      reenqueued,
    });
  } else {
    logger.info("FIT download reconciliation completed (nothing to do)");
  }
}

// ─── Worker ──────────────────────────────────────────────────────────────────

export const fitDownloadWorker = new Worker<FitDownloadJobData>(
  QUEUE_NAMES.FIT_DOWNLOAD,
  withErrorHandling(QUEUE_NAMES.FIT_DOWNLOAD, async (job) => {
    if (job.name === FIT_RECONCILE_JOB_NAME) {
      await reconcileFitDownloads();
      return;
    }

    if (job.data.source === "connect") {
      logger.info("FIT download job started (connect)", {
        queue: QUEUE_NAMES.FIT_DOWNLOAD,
        jobId: job.id,
        userId: job.data.userId,
        activityId: job.data.activityId,
        garminActivityId: job.data.garminActivityId,
        attempt: job.attemptsMade + 1,
      });
      await processConnectDownloadJob(job.data);
      return;
    }

    logger.info("FIT download job started", {
      queue: QUEUE_NAMES.FIT_DOWNLOAD,
      jobId: job.id,
      ledgerId: job.data.ledgerId,
      userId: job.data.userId,
      summaryId: job.data.summaryId,
      attempt: job.attemptsMade + 1,
    });

    await processDownloadJob(job.data);
  }),
  {
    connection: createRedisConnection(),
    concurrency: 2,
  },
);
