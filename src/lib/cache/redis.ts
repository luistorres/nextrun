/**
 * Redis cache utility.
 *
 * Singleton Redis connection for application-level caching (separate from
 * BullMQ's per-queue connections). Used for caching expensive computations
 * like AthleteAnalysis with configurable TTL.
 */

import { Redis } from "ioredis";

// ---------------------------------------------------------------------------
// Singleton connection
// ---------------------------------------------------------------------------

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

let _cacheClient: Redis | null = null;

function getCacheClient(): Redis {
  if (!_cacheClient) {
    _cacheClient = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
      keyPrefix: "vr:", // nextrun namespace
    });

    _cacheClient.on("error", (err) => {
      console.warn("[cache] Redis error:", err.message);
    });

    // Connect lazily on first use
    _cacheClient.connect().catch(() => {
      // Swallow connection errors — cache is best-effort
    });
  }
  return _cacheClient;
}

// ---------------------------------------------------------------------------
// Cache operations (best-effort — never throw)
// ---------------------------------------------------------------------------

/**
 * Get a cached value, parsed from JSON.
 * Returns null on miss or any error (cache is best-effort).
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await getCacheClient().get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Set a cache value as JSON with a TTL in seconds.
 * Silently fails on any error (cache is best-effort).
 */
export async function cacheSet(
  key: string,
  value: unknown,
  ttlSeconds: number,
): Promise<void> {
  try {
    await getCacheClient().set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    // Cache write failure is non-fatal
  }
}

/**
 * Delete a cached value.
 */
export async function cacheDel(key: string): Promise<void> {
  try {
    await getCacheClient().del(key);
  } catch {
    // Cache delete failure is non-fatal
  }
}

/**
 * Build a namespaced cache key for athlete analysis.
 * Includes planId when provided, since workoutPreferences depend on it.
 */
export function analysisKey(userId: string, planId?: string): string {
  // v2: AthleteAnalysis gained cadenceTrend — version the key so stale
  // cached shapes (6h TTL) are never deserialized into the new type.
  return planId ? `analysis:v2:${userId}:${planId}` : `analysis:v2:${userId}`;
}

/**
 * Delete all analysis cache entries for a user (with and without planId).
 */
export async function cacheDelByPrefix(prefix: string): Promise<void> {
  try {
    const client = getCacheClient();
    // keyPrefix is "vr:", so SCAN for "vr:<prefix>*"
    const pattern = `${client.options.keyPrefix ?? ""}${prefix}*`;
    let cursor = "0";
    do {
      const [next, keys] = await client.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = next;
      if (keys.length > 0) {
        // Keys from SCAN include the prefix, so use raw del
        await client.del(...keys);
      }
    } while (cursor !== "0");
  } catch {
    // Cache delete failure is non-fatal
  }
}
