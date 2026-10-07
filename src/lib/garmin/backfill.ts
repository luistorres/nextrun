// ─── Garmin Backfill Request Logic ───────────────────────────────────────────
//
// Requests historical data from Garmin Health API backfill endpoints.
// Garmin processes backfill requests asynchronously and pushes data via webhooks.
// Each request accepts a date range; we chunk large ranges into monthly periods.

import { getValidAccessToken } from "@/lib/garmin/token-manager";
import { GarminRateLimiter } from "@/lib/garmin/rate-limiter";

// ─── Constants ──────────────────────────────────────────────────────────────

const GARMIN_BACKFILL_BASE =
  "https://apis.garmin.com/wellness-api/rest/backfill";

/** Maximum days per backfill request (~31 days) */
const MAX_CHUNK_DAYS = 31;

/** Data types available for backfill */
export const BACKFILL_DATA_TYPES = [
  "dailySummaries",
  "activities",
  "sleep",
  "stress",
  "hrv",
] as const;

export type BackfillDataType = (typeof BACKFILL_DATA_TYPES)[number];

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BackfillRequestResult {
  dataType: BackfillDataType;
  startTimeSeconds: number;
  endTimeSeconds: number;
  success: boolean;
  httpStatus?: number;
  error?: string;
}

export interface BackfillChunkResult {
  startDate: string;
  endDate: string;
  results: BackfillRequestResult[];
  allSucceeded: boolean;
}

// ─── Date Chunking ──────────────────────────────────────────────────────────

interface DateChunk {
  startSeconds: number;
  endSeconds: number;
}

/**
 * Split a date range into chunks of at most MAX_CHUNK_DAYS.
 * Dates are ISO date strings (e.g. "2025-08-01").
 */
export function chunkDateRange(
  startDate: string,
  endDate: string
): DateChunk[] {
  const startMs = new Date(startDate).getTime();
  const endMs = new Date(endDate).getTime();

  if (startMs >= endMs) {
    return [];
  }

  const chunks: DateChunk[] = [];
  const chunkMs = MAX_CHUNK_DAYS * 24 * 60 * 60 * 1000;
  let currentStart = startMs;

  while (currentStart < endMs) {
    const currentEnd = Math.min(currentStart + chunkMs, endMs);
    chunks.push({
      startSeconds: Math.floor(currentStart / 1000),
      endSeconds: Math.floor(currentEnd / 1000),
    });
    currentStart = currentEnd;
  }

  return chunks;
}

// ─── Single Backfill Request ────────────────────────────────────────────────

/**
 * Request backfill for a single data type and time range.
 * Returns the HTTP response status and success/failure.
 */
async function requestBackfillForType(
  accessToken: string,
  dataType: BackfillDataType,
  startTimeSeconds: number,
  endTimeSeconds: number
): Promise<BackfillRequestResult> {
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

    return {
      dataType,
      startTimeSeconds,
      endTimeSeconds,
      success: response.ok,
      httpStatus: response.status,
      error: response.ok ? undefined : await response.text(),
    };
  } catch (error) {
    return {
      dataType,
      startTimeSeconds,
      endTimeSeconds,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ─── Backfill All Types for a Date Range ────────────────────────────────────

/**
 * Request backfill for all data types for a given date range.
 * Respects rate limits between consecutive API calls.
 * The date range is already expected to be a single chunk (max ~31 days).
 */
export async function requestBackfillForChunk(
  userId: string,
  startDate: string,
  endDate: string,
  rateLimiter?: GarminRateLimiter
): Promise<BackfillChunkResult> {
  const accessToken = await getValidAccessToken(userId);

  if (!accessToken) {
    return {
      startDate,
      endDate,
      results: BACKFILL_DATA_TYPES.map((dt) => ({
        dataType: dt,
        startTimeSeconds: 0,
        endTimeSeconds: 0,
        success: false,
        error: "No valid access token available",
      })),
      allSucceeded: false,
    };
  }

  const startSeconds = Math.floor(new Date(startDate).getTime() / 1000);
  const endSeconds = Math.floor(new Date(endDate).getTime() / 1000);
  const results: BackfillRequestResult[] = [];

  for (const dataType of BACKFILL_DATA_TYPES) {
    // Respect rate limits
    if (rateLimiter) {
      await rateLimiter.waitForSlot();
    }

    const result = await requestBackfillForType(
      accessToken,
      dataType,
      startSeconds,
      endSeconds
    );
    results.push(result);
  }

  return {
    startDate,
    endDate,
    results,
    allSucceeded: results.every((r) => r.success),
  };
}

// ─── Full Backfill Request ──────────────────────────────────────────────────

/**
 * Request backfill for all data types across a full date range.
 * Automatically chunks large date ranges into monthly periods.
 * Returns results for each chunk.
 */
export async function requestFullBackfill(
  userId: string,
  startDate: string,
  endDate: string,
  rateLimiter?: GarminRateLimiter
): Promise<BackfillChunkResult[]> {
  const chunks = chunkDateRange(startDate, endDate);
  const chunkResults: BackfillChunkResult[] = [];

  for (const chunk of chunks) {
    const chunkStartDate = new Date(chunk.startSeconds * 1000)
      .toISOString()
      .split("T")[0];
    const chunkEndDate = new Date(chunk.endSeconds * 1000)
      .toISOString()
      .split("T")[0];

    const result = await requestBackfillForChunk(
      userId,
      chunkStartDate,
      chunkEndDate,
      rateLimiter
    );
    chunkResults.push(result);
  }

  return chunkResults;
}
