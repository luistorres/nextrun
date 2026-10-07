/**
 * Pure state-machine decisions for the Garmin file-event ledger.
 *
 * The fit-download worker and the reconciliation cron delegate all
 * status-transition decisions to these functions so the logic is testable
 * without a database or network.
 *
 * Status lifecycle (see garminFileEvents in src/lib/db/schema/garmin.ts):
 *   received → enqueued → downloaded
 *                       ↘ failed_terminal (expired / 410 / unrecoverable)
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type FitFileEventStatus =
  | "received"
  | "enqueued"
  | "downloaded"
  | "failed_terminal";

/** The fields the state machine needs from a ledger row. */
export interface FitLedgerSnapshot {
  status: FitFileEventStatus;
  attempts: number;
  expiresAt: Date;
}

/** What a download job should do when it picks up a ledger row. */
export type FitDownloadDecision =
  | { action: "skip"; reason: "already_downloaded" | "already_terminal" }
  | { action: "expire" }
  | { action: "download" };

/** Outcome of a download attempt against the Garmin callback URL. */
export type FitDownloadOutcome =
  | { kind: "success" }
  | { kind: "gone" } // HTTP 410 — file consumed or expired, never retry
  | { kind: "transient_error"; message: string };

/** What the reconciliation cron should do with a stuck ledger row. */
export type FitReconcileDecision = "reenqueue" | "expire" | "leave";

/**
 * Max download attempts per ledger row. With exponential backoff starting at
 * 60s this keeps all retries well inside the 24h callback window — see
 * FIT_DOWNLOAD_JOB_OPTIONS in src/lib/queue/producer.ts for the math.
 */
export const MAX_FIT_DOWNLOAD_ATTEMPTS = 8;

// ─── Decisions ──────────────────────────────────────────────────────────────

/**
 * Decide what a download job should do for a ledger row.
 *
 * - downloaded / failed_terminal → no-op (idempotency: jobs may be re-run)
 * - past expiresAt → mark failed_terminal ("expired"); the callback URL is
 *   dead and Garmin will not re-ping
 * - otherwise → attempt the download
 */
export function decideFitDownloadAction(
  row: FitLedgerSnapshot,
  now: Date,
): FitDownloadDecision {
  if (row.status === "downloaded") {
    return { action: "skip", reason: "already_downloaded" };
  }
  if (row.status === "failed_terminal") {
    return { action: "skip", reason: "already_terminal" };
  }
  if (now >= row.expiresAt) {
    return { action: "expire" };
  }
  return { action: "download" };
}

/**
 * Map a download outcome to the next ledger status.
 *
 * `retryable: true` means the caller should increment attempts and rethrow
 * so BullMQ schedules a retry; terminal outcomes must NOT rethrow.
 */
export function nextStatusForOutcome(outcome: FitDownloadOutcome): {
  status: FitFileEventStatus;
  retryable: boolean;
  lastError: string | null;
} {
  switch (outcome.kind) {
    case "success":
      return { status: "downloaded", retryable: false, lastError: null };
    case "gone":
      // 410 is permanent: the file was already downloaded once or the URL
      // expired server-side. Retrying can never succeed.
      return {
        status: "failed_terminal",
        retryable: false,
        lastError: "callback URL gone (HTTP 410)",
      };
    case "transient_error":
      // Keep the current status; BullMQ owns the retry schedule.
      return { status: "enqueued", retryable: true, lastError: outcome.message };
  }
}

/**
 * Decide what the hourly reconciliation cron should do with a row.
 *
 * Rows stuck in received/enqueued (e.g. Redis lost the job, worker crashed
 * past its BullMQ retries, enqueue failed after the webhook 200'd) are
 * re-enqueued while the callback URL is still alive and attempts remain.
 */
export function decideReconciliationAction(
  row: FitLedgerSnapshot,
  now: Date,
  maxAttempts: number = MAX_FIT_DOWNLOAD_ATTEMPTS,
): FitReconcileDecision {
  if (row.status === "downloaded" || row.status === "failed_terminal") {
    return "leave";
  }
  if (now >= row.expiresAt) {
    return "expire";
  }
  if (row.attempts >= maxAttempts) {
    return "leave";
  }
  return "reenqueue";
}
