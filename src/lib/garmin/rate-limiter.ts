// ─── Garmin API Rate Limiter ─────────────────────────────────────────────────
//
// Simple token-bucket rate limiter to respect Garmin Health API rate limits.
// Configurable minimum delay between consecutive requests (default: 1 request/s).

// ─── Configuration ──────────────────────────────────────────────────────────

interface RateLimiterConfig {
  /** Minimum milliseconds between consecutive requests */
  minIntervalMs: number;
  /** Maximum burst requests allowed before throttling */
  maxBurst: number;
}

const DEFAULT_CONFIG: RateLimiterConfig = {
  minIntervalMs: 1_000, // 1 request per second for backfill
  maxBurst: 1, // No burst — strict sequential
};

// ─── Rate Limiter ───────────────────────────────────────────────────────────

export class GarminRateLimiter {
  private lastRequestTime = 0;
  private readonly config: RateLimiterConfig;

  constructor(config?: Partial<RateLimiterConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Wait until it is safe to make the next API request.
   * Resolves immediately if enough time has passed since the last request.
   */
  async waitForSlot(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    const waitTime = this.config.minIntervalMs - elapsed;

    if (waitTime > 0) {
      await sleep(waitTime);
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Reset the rate limiter state (useful for testing or after long pauses).
   */
  reset(): void {
    this.lastRequestTime = 0;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Singleton Instance ─────────────────────────────────────────────────────

/** Shared rate limiter for Garmin backfill API requests */
export const backfillRateLimiter = new GarminRateLimiter({
  minIntervalMs: 1_000,
  maxBurst: 1,
});
