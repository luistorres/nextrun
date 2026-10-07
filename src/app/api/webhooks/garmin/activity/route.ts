import { NextResponse } from "next/server";
import {
  activityPayloadSchema,
  validatePayload,
} from "@/lib/garmin/webhooks/validator";
import {
  resolveUser,
  updateLastSync,
  mapActivity,
} from "@/lib/garmin/webhooks/parser";
import { upsertActivity } from "@/lib/db/queries/activities";
import { getActivePlanWithWorkouts } from "@/lib/db/queries/training";
import { matchActivityToWorkout } from "@/lib/garmin/webhooks/activity-matcher";
import { markActivityForReview } from "@/lib/plan-engine/review-request";

/**
 * POST /api/webhooks/garmin/activity
 *
 * Receives batched activity data from Garmin Activity API.
 * After storing each activity, attempts to match it against a planned workout
 * and enqueues an event-adaptation job for the adaptation engine.
 * Always returns 200 — Garmin does not retry on failure.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const payload = validatePayload(
      activityPayloadSchema,
      body,
      "activity",
    );

    if (!payload) {
      return NextResponse.json({ status: "ok", processed: 0 });
    }

    let processed = 0;
    let errors = 0;

    for (const item of payload.activities) {
      try {
        const user = await resolveUser(item.userAccessToken);
        if (!user) {
          errors++;
          continue;
        }

        // Store the activity (upsert on garmin_activity_id)
        const activityData = mapActivity(user.userId, item);
        const storedActivity = await upsertActivity(activityData);
        await updateLastSync(user.userId);

        // Attempt to match the activity to a planned workout
        const matchResult = await matchActivityToWorkout(
          user.userId,
          storedActivity.id,
          storedActivity.activityType,
          storedActivity.startTime,
        );

        const plan = matchResult.planId
          ? { id: matchResult.planId }
          : await getActivePlanWithWorkouts(user.userId);

        if (plan) {
          await markActivityForReview(plan.id, storedActivity.id);
        }

        processed++;
      } catch (error) {
        console.error(
          `[webhook:activity] Error processing activity for token ${item.userAccessToken}:`,
          error,
        );
        errors++;
      }
    }

    console.info(
      `[webhook:activity] Processed ${processed}/${payload.activities.length} items (${errors} errors)`,
    );

    return NextResponse.json({ status: "ok", processed, errors });
  } catch (error) {
    console.error("[webhook:activity] Unhandled error:", error);
    return NextResponse.json({ status: "ok", processed: 0 });
  }
}
