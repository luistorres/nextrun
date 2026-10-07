import { Redis } from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

/**
 * Creates a new IORedis instance for BullMQ.
 *
 * BullMQ requires separate connections for Queue (producer) and Worker
 * (consumer), so this returns a new instance each time rather than a singleton.
 */
export function createRedisConnection(): Redis {
  return new Redis(REDIS_URL, {
    maxRetriesPerRequest: null, // Required by BullMQ
    enableReadyCheck: false,
  });
}
