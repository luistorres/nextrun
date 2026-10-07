// ─── Backfill Processor Worker ───────────────────────────────────────────────
//
// BullMQ worker that processes backfill queue jobs.
// Each job represents one monthly date range chunk.
// For each chunk, we request backfill from Garmin for all data types.
// Data arrives asynchronously via the existing webhook handlers.

import { Worker } from "bullmq";
import { eq } from "drizzle-orm";
import { createRedisConnection } from "../src/lib/queue/connection";
import { QUEUE_NAMES } from "../src/lib/queue/queues";
import type { BackfillJobData } from "../src/lib/queue/job-types";
import { logger } from "./shared/logger";
import { withErrorHandling } from "./shared/error-handler";
import { db } from "./shared/db";
import { garminConnections } from "../src/lib/db/schema";
import { decrypt } from "../src/lib/utils/encryption";
import { refreshAccessToken } from "../src/lib/garmin/auth";
import { encrypt } from "../src/lib/utils/encryption";

// ─── Constants ──────────────────────────────────────────────────────────────

const GARMIN_BACKFILL_BASE =
  "https://apis.garmin.com/wellness-api/rest/backfill";

/** Minimum delay between consecutive Garmin API requests (ms) */
const RATE_LIMIT_DELAY_MS = 1_000;

/** Proactively refresh tokens within 7 days of expiry */
const REFRESH_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

/** Data types to request backfill for */
const BACKFILL_DATA_TYPES = [
  "dailySummaries",
  "activities",
  "sleep",
  "stress",
  "hrv",
] as const;

type BackfillDataType = (typeof BACKFILL_DATA_TYPES)[number];

// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get a valid access token for the user, refreshing if needed.
 * This is a worker-local implementation that uses workers/shared/db
 * instead of the Next.js app db singleton.
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

  // Check if token needs refresh
  const needsRefresh =
    !connection.tokenExpiresAt ||
    Date.now() + REFRESH_THRESHOLD_MS >= connection.tokenExpiresAt.getTime();

  if (!needsRefresh) {
    return decryptedAccessToken;
  }

  // Attempt token refresh
  if (!connection.refreshToken) {
    logger.warn("Token expiring but no refresh token available", { userId });
    return decryptedAccessToken;
  }

  try {
    const decryptedRefreshToken = decrypt(connection.refreshToken);
    const newTokens = await refreshAccessToken(decryptedRefreshToken);

    // Store the refreshed tokens
    const encryptedAccessToken = encrypt(newTokens.access_token);
    const encryptedRefreshToken = encrypt(newTokens.refresh_token);
    const tokenExpiresAt = new Date(Date.now() + newTokens.expires_in * 1000);

    await db
      .update(garminConnections)
      .set({
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        tokenExpiresAt,
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

/**
 * Request backfill from Garmin for a single data type and time range.
 */
async function requestBackfillForType(
  accessToken: string,
  dataType: BackfillDataType,
  startTimeSeconds: number,
  endTimeSeconds: number
): Promise<{ success: boolean; httpStatus?: number; error?: string }> {
  const url = new URL(`${GARMIN_BACKFILL_BASE}/${dataType}`);
  url.searchParams.set(
    "summaryStartTimeInSeconds",
    startTimeSeconds.toString()
  );
  url.searchParams.set("summaryEndTimeInSeconds", endTimeSeconds.toString());

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (response.ok) {
      return { success: true, httpStatus: response.status };
    }

    const errorBody = await response.text();
    return {
      success: false,
      httpStatus: response.status,
      error: errorBody,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Update the backfill status in the database.
 */
async function updateBackfillStatus(
  userId: string,
  status: "pending" | "in_progress" | "completed" | "failed",
  completedAt?: Date
): Promise<void> {
  await db
    .update(garminConnections)
    .set({
      backfillStatus: status,
      ...(status === "in_progress"
        ? { backfillRequestedAt: new Date() }
        : {}),
      ...(completedAt ? { backfillCompletedAt: completedAt } : {}),
    })
    .where(eq(garminConnections.userId, userId));
}

// ─── Worker ─────────────────────────────────────────────────────────────────

export const backfillWorker = new Worker<BackfillJobData>(
  QUEUE_NAMES.BACKFILL,
  withErrorHandling(QUEUE_NAMES.BACKFILL, async (job) => {
    const { userId, startDate, endDate, chunkIndex } = job.data;

    logger.info("Processing backfill chunk", {
      queue: QUEUE_NAMES.BACKFILL,
      jobId: job.id,
      userId,
      startDate,
      endDate,
      chunkIndex,
    });

    // Step 1: Get valid access token
    const accessToken = await getAccessTokenForUser(userId);

    if (!accessToken) {
      logger.error("Cannot process backfill: no access token", {
        userId,
        chunkIndex,
      });
      await updateBackfillStatus(userId, "failed");
      throw new Error(`No access token available for user ${userId}`);
    }

    // Step 2: Convert dates to epoch seconds
    const startTimeSeconds = Math.floor(
      new Date(startDate).getTime() / 1000
    );
    const endTimeSeconds = Math.floor(new Date(endDate).getTime() / 1000);

    // Step 3: Request backfill for each data type with rate limiting
    const results: Array<{
      dataType: BackfillDataType;
      success: boolean;
      httpStatus?: number;
      error?: string;
    }> = [];

    for (const dataType of BACKFILL_DATA_TYPES) {
      // Rate limiting: wait between requests
      if (results.length > 0) {
        await sleep(RATE_LIMIT_DELAY_MS);
      }

      logger.info("Requesting backfill for data type", {
        userId,
        dataType,
        startDate,
        endDate,
        chunkIndex,
      });

      const result = await requestBackfillForType(
        accessToken,
        dataType,
        startTimeSeconds,
        endTimeSeconds
      );

      results.push({ dataType, ...result });

      if (result.success) {
        logger.info("Backfill request succeeded", {
          userId,
          dataType,
          httpStatus: result.httpStatus,
          chunkIndex,
        });
      } else {
        logger.warn("Backfill request failed", {
          userId,
          dataType,
          httpStatus: result.httpStatus,
          error: result.error,
          chunkIndex,
        });
      }

      // Update job progress
      const progress = Math.round(
        ((results.length) / BACKFILL_DATA_TYPES.length) * 100
      );
      await job.updateProgress(progress);
    }

    // Step 4: Evaluate results
    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    logger.info("Backfill chunk completed", {
      userId,
      chunkIndex,
      startDate,
      endDate,
      succeeded,
      failed,
      total: BACKFILL_DATA_TYPES.length,
    });

    // Step 5: Update backfill status
    // If this is the last chunk (chunkIndex === 0, since chunks go 0..5 from newest to oldest)
    // and all requests succeeded, mark as completed.
    // Otherwise keep as in_progress; the final chunk completion or a timeout will finalize it.
    if (chunkIndex === 0 && failed === 0) {
      // This is the most recent chunk (newest data) — mark as completed.
      // Older chunks may still be processing but the most critical data is requested.
      await updateBackfillStatus(userId, "completed", new Date());
      logger.info("Backfill marked as completed (primary chunk done)", {
        userId,
      });
    } else if (failed === BACKFILL_DATA_TYPES.length) {
      // All requests failed for this chunk — this is a serious problem
      // But don't mark the overall backfill as failed unless this is the only/first chunk
      if (chunkIndex === 0) {
        await updateBackfillStatus(userId, "failed");
        logger.error("Backfill marked as failed (all types failed on primary chunk)", {
          userId,
        });
      }
    }

    // If any requests failed, throw to trigger BullMQ retry (if retries remain)
    if (failed > 0) {
      const failedTypes = results
        .filter((r) => !r.success)
        .map((r) => `${r.dataType}: ${r.error}`)
        .join("; ");
      throw new Error(
        `Backfill chunk ${chunkIndex} had ${failed} failures: ${failedTypes}`
      );
    }
  }),
  {
    connection: createRedisConnection(),
    concurrency: 2,
  }
);
