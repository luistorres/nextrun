import { Redis } from "ioredis";

// Not the BullMQ connection from lib/queue: its maxRetriesPerRequest: null
// queues commands forever during a Redis outage, which would hang login.
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
});
redis.on("error", () => {});

export async function checkRateLimit(
  key: string,
  limit = 5,
  windowSec = 15 * 60,
): Promise<boolean> {
  try {
    const count = await redis.incr(`rl:${key}`);
    if (count === 1) await redis.expire(`rl:${key}`, windowSec);
    return count <= limit;
  } catch {
    // Fail open: allowlist bounds exposure and Garmin locks accounts upstream;
    // login availability wins for a small private app.
    return true;
  }
}
