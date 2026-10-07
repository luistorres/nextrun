import { NextResponse } from "next/server";
import {
  activityFilesPayloadSchema,
  validatePayload,
} from "@/lib/garmin/webhooks/validator";
import { resolveUser } from "@/lib/garmin/webhooks/parser";
import {
  upsertFileEvent,
  markFileEventEnqueued,
} from "@/lib/db/queries/file-events";
import { enqueueFitDownload } from "@/lib/queue/producer";

/**
 * POST /api/webhooks/garmin/activity-files
 *
 * Receives Activity File ping notifications from Garmin. Unlike the other
 * webhooks this is a ping, not a push: the payload only carries a
 * callbackURL that is valid for ~24h (and returns HTTP 410 once consumed).
 *
 * Garmin does NOT retry failed pings, so this handler does the absolute
 * minimum on the hot path: record the ping in the garmin_file_events ledger,
 * enqueue a fit-download job, and return 200. The actual download (with
 * aggressive in-window retries) happens in workers/fit-download.ts.
 *
 * Always returns 200 — Garmin does not retry on failure.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const payload = validatePayload(
      activityFilesPayloadSchema,
      body,
      "activity-files",
    );

    if (!payload) {
      return NextResponse.json({ status: "ok", processed: 0 });
    }

    let processed = 0;
    let errors = 0;

    for (const item of payload.activityFiles) {
      try {
        const user = await resolveUser(item.userAccessToken);
        if (!user) {
          errors++;
          continue;
        }

        // 1. Record the ping durably (upsert on userId+summaryId)
        const event = await upsertFileEvent({
          userId: user.userId,
          summaryId: item.summaryId,
          garminActivityId:
            item.activityId != null ? String(item.activityId) : null,
          fileType: item.fileType,
          callbackUrl: item.callbackURL,
        });

        // Already downloaded (duplicate ping) — nothing to do
        if (event.status === "downloaded") {
          processed++;
          continue;
        }

        // 2. Enqueue the download, then mark the ledger row as enqueued.
        // If the enqueue fails the row stays "received" and the hourly
        // reconciliation cron will pick it up.
        await enqueueFitDownload({
          ledgerId: event.id,
          userId: user.userId,
          summaryId: item.summaryId,
        });
        await markFileEventEnqueued(event.id);

        processed++;
      } catch (error) {
        console.error(
          `[webhook:activity-files] Error processing file ping for token ${item.userAccessToken}:`,
          error,
        );
        errors++;
      }
    }

    console.info(
      `[webhook:activity-files] Processed ${processed}/${payload.activityFiles.length} items (${errors} errors)`,
    );

    return NextResponse.json({ status: "ok", processed, errors });
  } catch (error) {
    console.error("[webhook:activity-files] Unhandled error:", error);
    return NextResponse.json({ status: "ok", processed: 0 });
  }
}
