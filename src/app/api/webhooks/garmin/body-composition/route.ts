import { NextResponse } from "next/server";
import {
  bodyCompositionPayloadSchema,
  validatePayload,
} from "@/lib/garmin/webhooks/validator";
import {
  resolveUser,
  updateLastSync,
  mapBodyComposition,
} from "@/lib/garmin/webhooks/parser";
import { upsertDailySummary } from "@/lib/db/queries/health";

/**
 * POST /api/webhooks/garmin/body-composition
 *
 * Receives batched body composition data from Garmin Health API.
 * Since we don't have a dedicated body_composition table, we store the
 * raw JSON as part of the daily summary for that date. This ensures no
 * data is lost (Garmin only retains 7 days).
 * Always returns 200 — Garmin does not retry on failure.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const payload = validatePayload(
      bodyCompositionPayloadSchema,
      body,
      "body-composition",
    );

    if (!payload) {
      return NextResponse.json({ status: "ok", processed: 0 });
    }

    let processed = 0;
    let errors = 0;

    for (const item of payload.bodyComps) {
      try {
        const user = await resolveUser(item.userAccessToken);
        if (!user) {
          errors++;
          continue;
        }

        const mapped = mapBodyComposition(user.userId, item);

        // Store as a daily summary row to preserve the raw JSON.
        // The upsert will merge with existing daily summary data if present.
        await upsertDailySummary({
          userId: mapped.userId,
          calendarDate: mapped.calendarDate,
          rawJson: mapped.rawJson as unknown as import("@/types/garmin").GarminDailySummary,
        });

        await updateLastSync(user.userId);
        processed++;
      } catch (error) {
        console.error(
          `[webhook:body-composition] Error processing item for token ${item.userAccessToken}:`,
          error,
        );
        errors++;
      }
    }

    console.info(
      `[webhook:body-composition] Processed ${processed}/${payload.bodyComps.length} items (${errors} errors)`,
    );

    return NextResponse.json({ status: "ok", processed, errors });
  } catch (error) {
    console.error("[webhook:body-composition] Unhandled error:", error);
    return NextResponse.json({ status: "ok", processed: 0 });
  }
}
