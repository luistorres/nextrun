import { NextResponse } from "next/server";
import {
  stressPayloadSchema,
  validatePayload,
} from "@/lib/garmin/webhooks/validator";
import {
  resolveUser,
  updateLastSync,
  mapStress,
} from "@/lib/garmin/webhooks/parser";
import { upsertStressRecord } from "@/lib/db/queries/health";

/**
 * POST /api/webhooks/garmin/stress
 *
 * Receives batched stress data from Garmin Health API.
 * Each POST contains a `stressDetails` array with items for one or more users.
 * Always returns 200 — Garmin does not retry on failure.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const payload = validatePayload(stressPayloadSchema, body, "stress");

    if (!payload) {
      return NextResponse.json({ status: "ok", processed: 0 });
    }

    let processed = 0;
    let errors = 0;

    for (const item of payload.stressDetails) {
      try {
        const user = await resolveUser(item.userAccessToken);
        if (!user) {
          errors++;
          continue;
        }

        const data = mapStress(user.userId, item);
        await upsertStressRecord(data);
        await updateLastSync(user.userId);
        processed++;
      } catch (error) {
        console.error(
          `[webhook:stress] Error processing item for token ${item.userAccessToken}:`,
          error,
        );
        errors++;
      }
    }

    console.info(
      `[webhook:stress] Processed ${processed}/${payload.stressDetails.length} items (${errors} errors)`,
    );

    return NextResponse.json({ status: "ok", processed, errors });
  } catch (error) {
    console.error("[webhook:stress] Unhandled error:", error);
    return NextResponse.json({ status: "ok", processed: 0 });
  }
}
