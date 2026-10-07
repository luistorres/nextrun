import type { GarminConnect } from "garmin-connect";
import { persistTokens } from "@/lib/garmin/connect-client";
import { importRecentData } from "@/lib/garmin/connect-importer";
import { markActivityForReview } from "@/lib/plan-engine/review-request";
import { getActivePlanWithWorkouts } from "@/lib/db/queries/training";

export async function syncRecentData(
  client: GarminConnect,
  userId: string,
  days: number,
) {
  const result = await importRecentData(client, userId, days);

  await persistTokens(userId, client);

  if (result.newActivities > 0 && result._lastNewActivityId) {
    // Unplanned activities match no workout but should still adapt the plan
    const planId =
      result._planId ?? (await getActivePlanWithWorkouts(userId))?.id ?? null;

    if (planId) {
      await markActivityForReview(planId, result._lastNewActivityId);
    }
  }

  return result;
}
