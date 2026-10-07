import { NextResponse } from "next/server";
import {
  dailySummaryPayloadSchema,
  validatePayload,
} from "@/lib/garmin/webhooks/validator";
import {
  resolveUser,
  updateLastSync,
  mapDailySummary,
} from "@/lib/garmin/webhooks/parser";
import { upsertDailySummary } from "@/lib/db/queries/health";

/**
 * POST /api/webhooks/garmin/daily-summary
 *
 * Receives batched daily health summaries from Garmin Health API.
 * Each POST contains a `dailies` array with items for one or more users.
 * Always returns 200 — Garmin does not retry on failure.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const payload = validatePayload(
      dailySummaryPayloadSchema,
      body,
      "daily-summary",
    );

    if (!payload) {
      // Log was already emitted by validatePayload — return 200 anyway
      return NextResponse.json({ status: "ok", processed: 0 });
    }

    let processed = 0;
    let errors = 0;

    for (const item of payload.dailies) {
      try {
        const user = await resolveUser(item.userAccessToken);
        if (!user) {
          errors++;
          continue;
        }

        const data = mapDailySummary(user.userId, item);
        await upsertDailySummary(data);
        await updateLastSync(user.userId);
        processed++;
      } catch (error) {
        console.error(
          `[webhook:daily-summary] Error processing item for token ${item.userAccessToken}:`,
          error,
        );
        errors++;
      }
    }

    console.info(
      `[webhook:daily-summary] Processed ${processed}/${payload.dailies.length} items (${errors} errors)`,
    );

    return NextResponse.json({ status: "ok", processed, errors });
  } catch (error) {
    console.error("[webhook:daily-summary] Unhandled error:", error);
    return NextResponse.json({ status: "ok", processed: 0 });
  }
}
