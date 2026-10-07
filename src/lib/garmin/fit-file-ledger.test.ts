import { describe, it, expect } from "vitest";
import {
  decideFitDownloadAction,
  decideReconciliationAction,
  nextStatusForOutcome,
  MAX_FIT_DOWNLOAD_ATTEMPTS,
  type FitLedgerSnapshot,
} from "./fit-file-ledger";

const NOW = new Date("2026-06-10T12:00:00Z");
const FUTURE = new Date("2026-06-11T06:00:00Z"); // inside the 24h window
const PAST = new Date("2026-06-10T11:00:00Z"); // window already closed

function row(overrides: Partial<FitLedgerSnapshot> = {}): FitLedgerSnapshot {
  return {
    status: "enqueued",
    attempts: 0,
    expiresAt: FUTURE,
    ...overrides,
  };
}

describe("decideFitDownloadAction", () => {
  it("skips rows that are already downloaded", () => {
    expect(decideFitDownloadAction(row({ status: "downloaded" }), NOW)).toEqual(
      { action: "skip", reason: "already_downloaded" },
    );
  });

  it("skips rows that already failed terminally", () => {
    expect(
      decideFitDownloadAction(row({ status: "failed_terminal" }), NOW),
    ).toEqual({ action: "skip", reason: "already_terminal" });
  });

  it("expires rows past their 24h callback window", () => {
    expect(decideFitDownloadAction(row({ expiresAt: PAST }), NOW)).toEqual({
      action: "expire",
    });
  });

  it("expires rows exactly at the expiry boundary", () => {
    expect(decideFitDownloadAction(row({ expiresAt: NOW }), NOW)).toEqual({
      action: "expire",
    });
  });

  it("downloads rows in received status inside the window", () => {
    expect(decideFitDownloadAction(row({ status: "received" }), NOW)).toEqual({
      action: "download",
    });
  });

  it("downloads rows in enqueued status inside the window", () => {
    expect(decideFitDownloadAction(row({ status: "enqueued" }), NOW)).toEqual({
      action: "download",
    });
  });

  it("prioritizes terminal-state skip over expiry", () => {
    // A downloaded row past expiry must stay downloaded, not be expired
    expect(
      decideFitDownloadAction(
        row({ status: "downloaded", expiresAt: PAST }),
        NOW,
      ),
    ).toEqual({ action: "skip", reason: "already_downloaded" });
  });
});

describe("nextStatusForOutcome", () => {
  it("maps success to downloaded (no retry)", () => {
    expect(nextStatusForOutcome({ kind: "success" })).toEqual({
      status: "downloaded",
      retryable: false,
      lastError: null,
    });
  });

  it("maps HTTP 410 to failed_terminal (never retried)", () => {
    const result = nextStatusForOutcome({ kind: "gone" });
    expect(result.status).toBe("failed_terminal");
    expect(result.retryable).toBe(false);
    expect(result.lastError).toContain("410");
  });

  it("maps transient errors to a retryable outcome that keeps the row pending", () => {
    const result = nextStatusForOutcome({
      kind: "transient_error",
      message: "HTTP 503 from callback URL",
    });
    expect(result.status).toBe("enqueued");
    expect(result.retryable).toBe(true);
    expect(result.lastError).toBe("HTTP 503 from callback URL");
  });
});

describe("decideReconciliationAction", () => {
  it("leaves downloaded rows alone", () => {
    expect(
      decideReconciliationAction(row({ status: "downloaded" }), NOW),
    ).toBe("leave");
  });

  it("leaves terminal rows alone", () => {
    expect(
      decideReconciliationAction(row({ status: "failed_terminal" }), NOW),
    ).toBe("leave");
  });

  it("expires stuck rows past their window", () => {
    expect(
      decideReconciliationAction(
        row({ status: "received", expiresAt: PAST }),
        NOW,
      ),
    ).toBe("expire");
  });

  it("re-enqueues stuck rows inside the window with budget remaining", () => {
    expect(
      decideReconciliationAction(row({ status: "received", attempts: 3 }), NOW),
    ).toBe("reenqueue");
    expect(
      decideReconciliationAction(row({ status: "enqueued", attempts: 0 }), NOW),
    ).toBe("reenqueue");
  });

  it("leaves rows that exhausted their attempt budget", () => {
    expect(
      decideReconciliationAction(
        row({ status: "enqueued", attempts: MAX_FIT_DOWNLOAD_ATTEMPTS }),
        NOW,
      ),
    ).toBe("leave");
  });

  it("prefers expiry over attempt exhaustion so dead rows stop being scanned", () => {
    expect(
      decideReconciliationAction(
        row({
          status: "enqueued",
          attempts: MAX_FIT_DOWNLOAD_ATTEMPTS,
          expiresAt: PAST,
        }),
        NOW,
      ),
    ).toBe("expire");
  });

  it("respects a custom maxAttempts", () => {
    expect(
      decideReconciliationAction(row({ attempts: 2 }), NOW, 2),
    ).toBe("leave");
    expect(
      decideReconciliationAction(row({ attempts: 1 }), NOW, 2),
    ).toBe("reenqueue");
  });
});
