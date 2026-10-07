import type { Job } from "bullmq";
import { logger } from "./logger";

/**
 * Register global handlers for unhandled rejections and uncaught exceptions
 * in the worker process.
 */
export function registerGlobalErrorHandlers(): void {
  process.on("unhandledRejection", (reason: unknown) => {
    logger.error("Unhandled rejection in worker process", {
      error: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });

  process.on("uncaughtException", (error: Error) => {
    logger.error("Uncaught exception in worker process", {
      error: error.message,
      stack: error.stack,
    });
    // Give the logger time to flush before exiting
    setTimeout(() => process.exit(1), 1000);
  });
}

/**
 * Wraps a worker processor function with structured error logging.
 *
 * On success the original return value is forwarded. On failure the error is
 * logged with full context (queue name, job id, stack trace) and then
 * re-thrown so BullMQ can handle retries.
 */
export function withErrorHandling<TData, TResult>(
  queueName: string,
  processor: (job: Job<TData>) => Promise<TResult>,
): (job: Job<TData>) => Promise<TResult> {
  return async (job: Job<TData>): Promise<TResult> => {
    try {
      return await processor(job);
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error("Job failed", {
        queue: queueName,
        jobId: job.id,
        jobName: job.name,
        attemptsMade: job.attemptsMade,
        error: error.message,
        stack: error.stack,
      });
      throw error; // Re-throw so BullMQ handles retry / failure
    }
  };
}
