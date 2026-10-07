// ─── Dashboard "Today" API types ─────────────────────────────────────────────
// Shared between GET /api/dashboard/today and the TodayHero client component.

import type { RecoveryStatus, RecoveryConfidence } from "@/lib/metrics/derived";

export type TodayState = "pre_run" | "post_run" | "rest_day" | "no_plan";

export type DataFreshness = "fresh" | "stale" | "none";

export interface TodayWorkout {
  id: string;
  workoutType: string;
  title: string;
  description: string | null;
  targetDistanceMeters: number | null;
  targetDurationSeconds: number | null;
  targetPaceSecondsPerKm: number | null;
}

export interface TomorrowPreview extends TodayWorkout {
  scheduledDate: string;
}

export interface TodayReadiness {
  status: RecoveryStatus;
  confidence: RecoveryConfidence;
  /** Human-readable signals backing the status, e.g. "HRV in your normal range" */
  drivers: string[];
  /** Human labels for components with no data, e.g. "HRV", "Sleep" */
  missing: string[];
}

export interface TodayGoalContext {
  raceName: string | null;
  raceDate: string;
  daysToRace: number;
  currentWeek: number;
  totalWeeks: number;
}

export interface TodayHeartbeat {
  /** ISO timestamp of the most recent adaptation-engine decision */
  checkedAt: string;
  message: string;
  /** True when the decision is still awaiting athlete review */
  pending: boolean;
}

export interface CompletedRunSummary {
  /** Null when the workout was marked complete without a linked activity */
  activityId: string | null;
  distanceMeters: number | null;
  durationSeconds: number | null;
  avgPaceSecondsPerKm: number | null;
  /** The matched planned workout, when the run was planned */
  workout: TodayWorkout | null;
  wasPlanned: boolean;
  rpeGiven: boolean;
  feedbackGiven: boolean;
}

interface TodayBase {
  /** Server-side "today" (yyyy-MM-dd) used for all plan lookups */
  date: string;
  readiness: TodayReadiness;
  dataFreshness: DataFreshness;
  goalContext: TodayGoalContext | null;
  heartbeat: TodayHeartbeat | null;
  hasAnyHealthData: boolean;
  garminConnected: boolean;
}

export type TodayResponse =
  | (TodayBase & { state: "pre_run"; workout: TodayWorkout })
  | (TodayBase & { state: "post_run"; completed: CompletedRunSummary })
  | (TodayBase & { state: "rest_day"; tomorrow: TomorrowPreview | null })
  | (TodayBase & { state: "no_plan" });
