/**
 * Garmin Webhook payload wrapper types.
 *
 * Garmin pushes batched payloads — each POST contains an array of items
 * potentially spanning multiple users. Each item includes a `userAccessToken`
 * that identifies the originating Garmin user.
 *
 * The raw types for individual items are defined in @/types/garmin.ts.
 */

export type {
  GarminDailySummary,
  GarminActivity,
  GarminSleep,
  GarminStress,
  GarminHRV,
  GarminBodyComposition,
  GarminUserMetrics,
  GarminDeregistration,
} from "@/types/garmin";

// ─── Batched Webhook Payloads ──────────────────────────────────────────────
// Garmin POSTs arrays keyed by the data type name.

/** Daily summary webhook: { "dailies": [...] } */
export interface DailySummaryWebhookPayload {
  dailies: import("@/types/garmin").GarminDailySummary[];
}

/** Activity webhook: { "activities": [...] } */
export interface ActivityWebhookPayload {
  activities: import("@/types/garmin").GarminActivity[];
}

/** Sleep webhook: { "sleeps": [...] } */
export interface SleepWebhookPayload {
  sleeps: import("@/types/garmin").GarminSleep[];
}

/** Stress webhook: { "stressDetails": [...] } */
export interface StressWebhookPayload {
  stressDetails: import("@/types/garmin").GarminStress[];
}

/** HRV webhook: { "hrvSummaries": [...] } OR { "allDayHRV": [...] } */
export interface HRVWebhookPayload {
  hrvSummaries?: import("@/types/garmin").GarminHRV[];
  allDayHRV?: import("@/types/garmin").GarminHRV[];
}

/** Body composition webhook: { "bodyComps": [...] } */
export interface BodyCompositionWebhookPayload {
  bodyComps: import("@/types/garmin").GarminBodyComposition[];
}

/** User metrics webhook: { "userMetrics": [...] } */
export interface UserMetricsWebhookPayload {
  userMetrics: import("@/types/garmin").GarminUserMetrics[];
}

/** Deregistration webhook: { "deregistrations": [...] } */
export interface DeregistrationWebhookPayload {
  deregistrations: import("@/types/garmin").GarminDeregistration[];
}

// ─── User Lookup Result ────────────────────────────────────────────────────

export interface ResolvedUser {
  userId: string;
  garminUserId: string;
}
