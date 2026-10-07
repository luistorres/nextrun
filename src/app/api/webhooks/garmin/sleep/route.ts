import { NextResponse } from "next/server";
import {
  sleepPayloadSchema,
  validatePayload,
} from "@/lib/garmin/webhooks/validator";
import {
  resolveUser,
  updateLastSync,
  mapSleep,
} from "@/lib/garmin/webhooks/parser";
import { upsertSleepRecord } from "@/lib/db/queries/health";

/**
 * POST /api/webhooks/garmin/sleep
 *
 * Receives batched sleep data from Garmin Health API.
 * Each POST contains a `sleeps` array with items for one or more users.
 * Always returns 200 — Garmin does not retry on failure.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const payload = validatePayload(sleepPayloadSchema, body, "sleep");

    if (!payload) {
      return NextResponse.json({ status: "ok", processed: 0 });
    }

    let processed = 0;
    let errors = 0;

    for (const item of payload.sleeps) {
      try {
        const user = await resolveUser(item.userAccessToken);
        if (!user) {
          errors++;
          continue;
        }

        const data = mapSleep(user.userId, item);
        await upsertSleepRecord(data);
        await updateLastSync(user.userId);
        processed++;
      } catch (error) {
        console.error(
          `[webhook:sleep] Error processing item for token ${item.userAccessToken}:`,
          error,
        );
        errors++;
      }
    }

    console.info(
      `[webhook:sleep] Processed ${processed}/${payload.sleeps.length} items (${errors} errors)`,
    );

    return NextResponse.json({ status: "ok", processed, errors });
  } catch (error) {
    console.error("[webhook:sleep] Unhandled error:", error);
    return NextResponse.json({ status: "ok", processed: 0 });
  }
}
