import { NextResponse } from "next/server";
import {
  userMetricsPayloadSchema,
  validatePayload,
} from "@/lib/garmin/webhooks/validator";
import {
  resolveUser,
  updateLastSync,
  mapUserMetrics,
} from "@/lib/garmin/webhooks/parser";
import { upsertDailySummary } from "@/lib/db/queries/health";

/**
 * POST /api/webhooks/garmin/user-metrics
 *
 * Receives batched user metrics (VO2 max, fitness age, etc.) from Garmin.
 * We merge VO2 max into the daily summary for that calendar date.
 * Always returns 200 — Garmin does not retry on failure.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const payload = validatePayload(
      userMetricsPayloadSchema,
      body,
      "user-metrics",
    );

    if (!payload) {
      return NextResponse.json({ status: "ok", processed: 0 });
    }

    let processed = 0;
    let errors = 0;

    for (const item of payload.userMetrics) {
      try {
        const user = await resolveUser(item.userAccessToken);
        if (!user) {
          errors++;
          continue;
        }

        const mapped = mapUserMetrics(user.userId, item);

        // Merge VO2 max into the daily summary for this date.
        // The upsert will merge with existing daily summary data if present.
        await upsertDailySummary({
          userId: mapped.userId,
          calendarDate: mapped.calendarDate,
          vo2Max: mapped.vo2Max,
          rawJson: mapped.rawJson as unknown as import("@/types/garmin").GarminDailySummary,
        });

        await updateLastSync(user.userId);
        processed++;
      } catch (error) {
        console.error(
          `[webhook:user-metrics] Error processing item for token ${item.userAccessToken}:`,
          error,
        );
        errors++;
      }
    }

    console.info(
      `[webhook:user-metrics] Processed ${processed}/${payload.userMetrics.length} items (${errors} errors)`,
    );

    return NextResponse.json({ status: "ok", processed, errors });
  } catch (error) {
    console.error("[webhook:user-metrics] Unhandled error:", error);
    return NextResponse.json({ status: "ok", processed: 0 });
  }
}
