// Garmin Webhooks barrel export

export type {
  DailySummaryWebhookPayload,
  ActivityWebhookPayload,
  SleepWebhookPayload,
  StressWebhookPayload,
  HRVWebhookPayload,
  BodyCompositionWebhookPayload,
  UserMetricsWebhookPayload,
  DeregistrationWebhookPayload,
  ResolvedUser,
} from "./types";

export {
  resolveUser,
  updateLastSync,
  mapDailySummary,
  mapActivity,
  mapSleep,
  mapStress,
  mapHRV,
  mapBodyComposition,
  mapUserMetrics,
} from "./parser";

export {
  validatePayload,
  dailySummaryPayloadSchema,
  activityPayloadSchema,
  sleepPayloadSchema,
  stressPayloadSchema,
  hrvPayloadSchema,
  bodyCompositionPayloadSchema,
  userMetricsPayloadSchema,
  deregistrationPayloadSchema,
} from "./validator";

export { matchActivityToWorkout } from "./activity-matcher";
