import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { garminConnections } from "@/lib/db/schema";
import {
  deregistrationPayloadSchema,
  validatePayload,
} from "@/lib/garmin/webhooks/validator";
import { resolveUser } from "@/lib/garmin/webhooks/parser";
import { getStorage } from "@/lib/storage";

/**
 * POST /api/webhooks/garmin/deregistration
 *
 * Received when a user revokes access to our application in Garmin Connect.
 * We delete the garmin_connections row for the user so they are effectively
 * disconnected. Their historical data remains in the database, but stored
 * Garmin activity files (FIT — contain GPS tracks) are deleted best-effort:
 * unlike DB rows they do not cascade, so GDPR cleanup must be explicit.
 * Always returns 200 — Garmin does not retry on failure.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const payload = validatePayload(
      deregistrationPayloadSchema,
      body,
      "deregistration",
    );

    if (!payload) {
      return NextResponse.json({ status: "ok", processed: 0 });
    }

    let processed = 0;
    let errors = 0;

    for (const item of payload.deregistrations) {
      try {
        const user = await resolveUser(item.userAccessToken);
        if (!user) {
          // User may already have been deregistered
          console.warn(
            `[webhook:deregistration] No connection found for token ${item.userAccessToken}`,
          );
          errors++;
          continue;
        }

        // Delete the Garmin connection row
        await db
          .delete(garminConnections)
          .where(eq(garminConnections.userId, user.userId));

        console.info(
          `[webhook:deregistration] Deleted Garmin connection for user ${user.userId}`,
        );

        // Best-effort cleanup of stored FIT files (GPS data) — log failures
        // but never block the webhook response.
        try {
          await getStorage().deleteUserFiles(user.userId);
        } catch (cleanupError) {
          console.error(
            `[webhook:deregistration] Failed to delete stored files for user ${user.userId} (non-fatal):`,
            cleanupError,
          );
        }

        processed++;
      } catch (error) {
        console.error(
          `[webhook:deregistration] Error processing item for token ${item.userAccessToken}:`,
          error,
        );
        errors++;
      }
    }

    console.info(
      `[webhook:deregistration] Processed ${processed}/${payload.deregistrations.length} items (${errors} errors)`,
    );

    return NextResponse.json({ status: "ok", processed, errors });
  } catch (error) {
    console.error("[webhook:deregistration] Unhandled error:", error);
    return NextResponse.json({ status: "ok", processed: 0 });
  }
}
