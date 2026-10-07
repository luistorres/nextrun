/**
 * Aggregate metrics from multiple activities linked to a single planned workout.
 *
 * When a user splits a workout across several activities in one day
 * (e.g. 3.5 km easy run + 3 km easy run = 6.5 km total against a 5.5 km target),
 * this utility sums distance and duration so callers get the full picture.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LinkedActivity {
  distanceMeters: number | string | null;
  durationSeconds: number;
}

export interface AggregatedExecution {
  /** Total distance across all linked activities (meters) */
  totalDistanceMeters: number;
  /** Total duration across all linked activities (seconds) */
  totalDurationSeconds: number;
  /** Number of activities contributing */
  activityCount: number;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export function aggregateLinkedActivities(
  activities: LinkedActivity[],
): AggregatedExecution {
  let totalDistanceMeters = 0;
  let totalDurationSeconds = 0;

  for (const a of activities) {
    totalDistanceMeters += a.distanceMeters
      ? parseFloat(String(a.distanceMeters))
      : 0;
    totalDurationSeconds += a.durationSeconds;
  }

  return {
    totalDistanceMeters,
    totalDurationSeconds,
    activityCount: activities.length,
  };
}
