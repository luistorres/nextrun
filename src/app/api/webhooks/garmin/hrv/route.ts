import { NextResponse } from "next/server";
import {
  hrvPayloadSchema,
  validatePayload,
} from "@/lib/garmin/webhooks/validator";
import {
  resolveUser,
  updateLastSync,
  mapHRV,
} from "@/lib/garmin/webhooks/parser";
import { upsertHrvRecord } from "@/lib/db/queries/health";

/**
 * POST /api/webhooks/garmin/hrv
 *
 * Receives batched HRV (Heart Rate Variability) data from Garmin Health API.
 * Garmin may send the array under either `hrvSummaries` or `allDayHRV`.
 * Always returns 200 — Garmin does not retry on failure.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const payload = validatePayload(hrvPayloadSchema, body, "hrv");

    if (!payload) {
      return NextResponse.json({ status: "ok", processed: 0 });
    }

    // Garmin may use either key
    const items = payload.hrvSummaries ?? payload.allDayHRV ?? [];

    let processed = 0;
    let errors = 0;

    for (const item of items) {
      try {
        const user = await resolveUser(item.userAccessToken);
        if (!user) {
          errors++;
          continue;
        }

        const data = mapHRV(user.userId, item);
        await upsertHrvRecord(data);
        await updateLastSync(user.userId);
        processed++;
      } catch (error) {
        console.error(
          `[webhook:hrv] Error processing item for token ${item.userAccessToken}:`,
          error,
        );
        errors++;
      }
    }

    console.info(
      `[webhook:hrv] Processed ${processed}/${items.length} items (${errors} errors)`,
    );

    return NextResponse.json({ status: "ok", processed, errors });
  } catch (error) {
    console.error("[webhook:hrv] Unhandled error:", error);
    return NextResponse.json({ status: "ok", processed: 0 });
  }
}
