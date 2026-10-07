/** Job payload for historical Garmin data fetching */
export interface BackfillJobData {
  userId: string;
  startDate: string;
  endDate: string;
  chunkIndex: number;
}

/** Job payload for AI training plan generation */
export interface PlanGenerationJobData {
  userId: string;
  goalId: string;
  isRefinement: boolean;
}

/** Job payload for scheduled weekly plan adaptation */
export interface WeeklyAdaptationJobData {
  userId: string;
  planId: string;
}

/** Job payload for event-triggered adaptation (e.g. unplanned activity) */
export interface EventAdaptationJobData {
  userId: string;
  planId: string;
  activityId: string | null;
}

/** Job payload for pushing workouts to Garmin Training API */
export interface GarminSyncJobData {
  userId: string;
  workoutIds: string[];
  action: "create" | "update" | "delete";
  /** For delete actions: Garmin workout IDs to remove (when DB rows are already gone) */
  garminWorkoutIds?: string[];
}

/** Job payload for heavy webhook post-processing */
export interface WebhookProcessingJobData {
  userId: string;
  dataType: string;
  payload: unknown;
}

/**
 * Job payload for downloading a Garmin activity file (FIT/TCX/GPX)
 * announced via the official activity-files ping webhook (ledger-backed,
 * 24h callback window). Kept dormant while the unofficial path is primary.
 */
export interface FitDownloadPingJobData {
  source?: "ping";
  /** garmin_file_events ledger row id */
  ledgerId: string;
  userId: string;
  summaryId: string;
}

/**
 * Job payload for downloading the original FIT file via the unofficial
 * Garmin Connect client (credential flow). No callback window — the
 * download URL is permanent, so no ledger row is needed.
 */
export interface FitDownloadConnectJobData {
  source: "connect";
  userId: string;
  /** Internal activities.id to attach the file + decoded metrics to */
  activityId: string;
  /** Garmin Connect activity id (download URL + storage key) */
  garminActivityId: string;
}

/** Job payload for the fit-download queue (ping or connect variant) */
export type FitDownloadJobData =
  | FitDownloadPingJobData
  | FitDownloadConnectJobData;

/** Job payload for the initial 90-day import after first Garmin sign-in */
export interface ConnectBackfillJobData {
  userId: string;
}
