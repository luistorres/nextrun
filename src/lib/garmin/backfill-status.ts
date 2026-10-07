// ─── Backfill Progress Tracking ──────────────────────────────────────────────
//
// Tracks which data types have been requested, which have completed, and
// provides an overall backfill status for the user.
//
// Completion heuristic:
//   - A backfill is considered complete when all data types for all chunks
//     have been requested successfully.
//   - Since Garmin pushes data asynchronously via webhooks, we use a timeout
//     heuristic: mark the overall backfill as "completed" after 30 minutes
//     from the last request if all requests were successful.
//   - The webhook handlers can also call markBackfillComplete() when they
//     detect that incoming data covers the requested date range.

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { garminConnections } from "@/lib/db/schema";
import type { BackfillDataType } from "@/lib/garmin/backfill";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Time after the last successful backfill request to auto-mark complete */
const COMPLETION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BackfillTypeStatus {
  dataType: BackfillDataType;
  requested: boolean;
  requestedAt: string | null;
  chunksRequested: number;
  chunksSucceeded: number;
  chunksFailed: number;
  lastError: string | null;
}

export interface BackfillProgress {
  /** Overall status from garmin_connections table */
  overallStatus: "pending" | "in_progress" | "completed" | "failed";
  /** When the backfill was first requested */
  requestedAt: string | null;
  /** When the backfill completed (if applicable) */
  completedAt: string | null;
  /** Per-data-type breakdown */
  dataTypes: BackfillTypeStatus[];
  /** Total chunks expected across all types */
  totalChunks: number;
  /** Total chunks successfully requested */
  completedChunks: number;
  /** Estimated time remaining (null if unknown or already complete) */
  estimatedCompletionAt: string | null;
}

// ─── In-Memory Status Tracking ──────────────────────────────────────────────
//
// The detailed per-type tracking is kept in memory on the worker process.
// The overall status is persisted in the database via garmin_connections.
// This is acceptable because:
//   1. Backfill is a one-time operation per user connection
//   2. If the worker restarts mid-backfill, jobs will be retried by BullMQ
//   3. The DB stores the authoritative overall status

const userBackfillState = new Map<string, Map<BackfillDataType, BackfillTypeStatus>>();

/**
 * Initialize tracking state for a user's backfill operation.
 */
export function initBackfillTracking(
  userId: string,
  dataTypes: BackfillDataType[]
): void {
  const typeMap = new Map<BackfillDataType, BackfillTypeStatus>();

  for (const dt of dataTypes) {
    typeMap.set(dt, {
      dataType: dt,
      requested: false,
      requestedAt: null,
      chunksRequested: 0,
      chunksSucceeded: 0,
      chunksFailed: 0,
      lastError: null,
    });
  }

  userBackfillState.set(userId, typeMap);
}

/**
 * Record the result of a backfill request for a specific data type and chunk.
 */
export function recordChunkResult(
  userId: string,
  dataType: BackfillDataType,
  success: boolean,
  error?: string
): void {
  const typeMap = userBackfillState.get(userId);
  if (!typeMap) return;

  const status = typeMap.get(dataType);
  if (!status) return;

  status.requested = true;
  status.requestedAt = status.requestedAt ?? new Date().toISOString();
  status.chunksRequested += 1;

  if (success) {
    status.chunksSucceeded += 1;
  } else {
    status.chunksFailed += 1;
    status.lastError = error ?? "Unknown error";
  }
}

/**
 * Get the current backfill tracking state for a user (from in-memory store).
 */
export function getTrackingState(
  userId: string
): BackfillTypeStatus[] | null {
  const typeMap = userBackfillState.get(userId);
  if (!typeMap) return null;
  return Array.from(typeMap.values());
}

/**
 * Clean up in-memory tracking state for a user after backfill completes.
 */
export function clearTrackingState(userId: string): void {
  userBackfillState.delete(userId);
}

// ─── Database Status Updates ────────────────────────────────────────────────

/**
 * Mark the user's backfill as in_progress in the database.
 */
export async function markBackfillInProgress(userId: string): Promise<void> {
  await db
    .update(garminConnections)
    .set({
      backfillStatus: "in_progress",
      backfillRequestedAt: new Date(),
    })
    .where(eq(garminConnections.userId, userId));
}

/**
 * Mark the user's backfill as completed in the database.
 */
export async function markBackfillComplete(userId: string): Promise<void> {
  await db
    .update(garminConnections)
    .set({
      backfillStatus: "completed",
      backfillCompletedAt: new Date(),
    })
    .where(eq(garminConnections.userId, userId));

  // Clean up in-memory tracking
  clearTrackingState(userId);
}

/**
 * Mark the user's backfill as failed in the database.
 */
export async function markBackfillFailed(userId: string): Promise<void> {
  await db
    .update(garminConnections)
    .set({
      backfillStatus: "failed",
    })
    .where(eq(garminConnections.userId, userId));
}

// ─── Progress Query ─────────────────────────────────────────────────────────

/**
 * Get the backfill progress for a user by reading the database record
 * and combining it with any in-memory tracking state.
 */
export async function getBackfillProgress(
  userId: string
): Promise<BackfillProgress | null> {
  const connection = await db
    .select({
      backfillStatus: garminConnections.backfillStatus,
      backfillRequestedAt: garminConnections.backfillRequestedAt,
      backfillCompletedAt: garminConnections.backfillCompletedAt,
    })
    .from(garminConnections)
    .where(eq(garminConnections.userId, userId))
    .then((rows) => rows[0] ?? null);

  if (!connection) return null;

  // Get in-memory tracking state if available
  const typeStatuses = getTrackingState(userId);
  const dataTypes: BackfillTypeStatus[] = typeStatuses ?? [];

  const totalChunks = dataTypes.reduce((sum, dt) => sum + dt.chunksRequested, 0);
  const completedChunks = dataTypes.reduce(
    (sum, dt) => sum + dt.chunksSucceeded,
    0
  );

  // Estimate completion time based on the timeout heuristic
  let estimatedCompletionAt: string | null = null;
  if (
    connection.backfillStatus === "in_progress" &&
    connection.backfillRequestedAt
  ) {
    const estimatedTime = new Date(
      connection.backfillRequestedAt.getTime() + COMPLETION_TIMEOUT_MS
    );
    estimatedCompletionAt = estimatedTime.toISOString();
  }

  return {
    overallStatus: connection.backfillStatus as BackfillProgress["overallStatus"],
    requestedAt: connection.backfillRequestedAt?.toISOString() ?? null,
    completedAt: connection.backfillCompletedAt?.toISOString() ?? null,
    dataTypes,
    totalChunks,
    completedChunks,
    estimatedCompletionAt,
  };
}
