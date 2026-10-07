import {
  pgTable,
  text,
  integer,
  numeric,
  boolean,
  date,
  timestamp,
  jsonb,
  uuid,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./auth";
import type { WorkoutStep, AdaptationChange, GeneratedWorkout } from "@/types/plan";
import type { HealthConstraint } from "@/types/health";

// ─── User Goals ─────────────────────────────────────────────────────────────
// Represents a training objective (e.g. run a half marathon on a specific date).

export const userGoals = pgTable("user_goals", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  goalType: text("goal_type").notNull(),
  raceName: text("race_name"),
  raceDate: date("race_date"),
  targetDistanceMeters: integer("target_distance_meters").notNull(),
  targetTimeSeconds: integer("target_time_seconds"),
  trainingDaysPerWeek: integer("training_days_per_week").notNull(),
  preferredTrainingDays: jsonb("preferred_training_days")
    .notNull()
    .$type<string[]>(),
  preferredLongRunDay: text("preferred_long_run_day").notNull(),
  constraints: text("constraints"),
  /**
   * Structured health/injury constraints (He et al., 2026).
   * Enables deterministic guardrail enforcement and structured AI context,
   * replacing ambiguous free-text interpretation.
   * Kept alongside `constraints` text for backward compatibility.
   */
  healthConstraints: jsonb("health_constraints")
    .$type<HealthConstraint[]>()
    .default(sql`'[]'::jsonb`),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Training Plans ─────────────────────────────────────────────────────────
// A versioned training plan linked to a user goal.
// Each adaptation creates a new plan version, superseding the previous one.

export const trainingPlans = pgTable("training_plans", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  goalId: uuid("goal_id")
    .notNull()
    .references(() => userGoals.id, { onDelete: "cascade" }),
  planVersion: integer("plan_version").notNull().default(1),
  phase: text("phase").notNull(),
  currentWeek: integer("current_week").notNull(),
  totalWeeks: integer("total_weeks").notNull(),
  weeklyMileageTargetKm: numeric("weekly_mileage_target_km").notNull(),
  generatedBy: text("generated_by").notNull(),
  generationContext: jsonb("generation_context"),
  status: text("status").notNull().default("active"),
  // Adaptation reviews run only when the athlete opens the app; these decide
  // whether a visit has anything new worth reviewing.
  reviewRequestedAt: timestamp("review_requested_at", { withTimezone: true }),
  unreviewedActivityId: uuid("unreviewed_activity_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});

// ─── Planned Workouts ───────────────────────────────────────────────────────
// Individual workouts within a training plan.
// Contains structured steps that can be synced to Garmin devices.

export const plannedWorkouts = pgTable(
  "planned_workouts",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    planId: uuid("plan_id")
      .notNull()
      .references(() => trainingPlans.id, { onDelete: "cascade" }),
    scheduledDate: date("scheduled_date").notNull(),
    dayOfWeek: text("day_of_week").notNull(),
    workoutType: text("workout_type").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    targetDistanceMeters: integer("target_distance_meters"),
    targetDurationSeconds: integer("target_duration_seconds"),
    targetPaceMinPerKm: numeric("target_pace_min_per_km"),
    targetHeartRateZone: integer("target_heart_rate_zone"),
    workoutSteps: jsonb("workout_steps").$type<WorkoutStep[]>(),
    garminWorkoutId: text("garmin_workout_id"),
    syncStatus: text("sync_status").notNull().default("pending"),
    completionStatus: text("completion_status").notNull().default("pending"),
    completedActivityId: uuid("completed_activity_id"),
    /** Rate of Perceived Exertion (Borg CR-10 scale, 1–10). Set by athlete when marking workout complete. */
    rpeScore: integer("rpe_score"),
    /** Athlete's qualitative difficulty assessment for this workout. */
    perceivedDifficulty: text("perceived_difficulty"),
    skipReason: text("skip_reason"),
    sortOrder: integer("sort_order").notNull(),
    adaptationId: uuid("adaptation_id").references(() => adaptations.id),
    originalWorkoutId: uuid("original_workout_id"),
  },
  (table) => ({
    planDateIdx: index("planned_workouts_plan_date_idx").on(
      table.planId,
      table.scheduledDate
    ),
  })
);

// ─── Athlete Response Patterns ──────────────────────────────────────────────
// Per-athlete computed patterns derived from accumulated training + health data.
// Recalculated weekly. Requires 6+ data points per metric before storing.

export type ResponseType = "volume_responder" | "intensity_responder" | "balanced" | "unknown";

export const athleteResponsePatterns = pgTable("athlete_response_patterns", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Hours for HRV to return within 5% of baseline after interval sessions */
  hrvRecoveryAfterIntervals: numeric("hrv_recovery_after_intervals"),
  /** Hours for HRV to return within 5% of baseline after long runs */
  hrvRecoveryAfterLongRuns: numeric("hrv_recovery_after_long_runs"),
  /** Whether athlete responds better to volume or intensity */
  responseType: text("response_type").$type<ResponseType>().default("unknown"),
  /** Best days of week for hard sessions (by average recovery readiness) */
  optimalHardDays: jsonb("optimal_hard_days").$type<string[]>(),
  /** Pace:HR decoupling rate (% HR drift per 30 min of easy running) */
  paceHrDecouplingRate: numeric("pace_hr_decoupling_rate"),
  /** Number of data points used for each pattern */
  dataPoints: jsonb("data_points").$type<Record<string, number>>(),
  /** When this pattern was last recalculated */
  computedAt: timestamp("computed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Adaptations ────────────────────────────────────────────────────────────
// Records each plan adaptation with the trigger, changes, and reasoning.

export const adaptations = pgTable("adaptations", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  planId: uuid("plan_id")
    .notNull()
    .references(() => trainingPlans.id, { onDelete: "cascade" }),
  oldPlanVersion: integer("old_plan_version").notNull(),
  newPlanVersion: integer("new_plan_version").notNull(),
  triggerType: text("trigger_type").notNull(),
  changes: jsonb("changes").notNull().$type<AdaptationChange[]>(),
  updatedWorkouts: jsonb("updated_workouts").$type<GeneratedWorkout[]>(),
  explanation: text("explanation").notNull(),
  metricsSnapshot: jsonb("metrics_snapshot"),
  accepted: boolean("accepted"),
  // Set when a newer proposal replaced this one while it was still pending.
  // Kept separate from `accepted = false` so replaced proposals never count
  // as the athlete declining (workout-preference reads that as a signal).
  supersededAt: timestamp("superseded_at", { withTimezone: true }),
  userContext: text("user_context"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Workout Feedback ──────────────────────────────────────────────────────
// Athlete-submitted feedback tied to workouts or standalone daily check-ins.
// Feeds into adaptation context so the AI coach understands subjective state.

export type FeedbackSentiment =
  | "feeling_great"
  | "feeling_good"
  | "feeling_okay"
  | "feeling_tired"
  | "feeling_terrible";

export type FeedbackType =
  | "post_workout"
  | "skip_reason"
  | "daily_checkin"
  | "general";

export type PainSeverity = "mild" | "moderate" | "severe";

export interface PainArea {
  area: string;
  severity: PainSeverity;
}

export const workoutFeedback = pgTable(
  "workout_feedback",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    plannedWorkoutId: uuid("planned_workout_id").references(
      () => plannedWorkouts.id,
      { onDelete: "set null" },
    ),
    activityId: uuid("activity_id"),
    sentiment: text("sentiment").$type<FeedbackSentiment>(),
    reasonForMiss: text("reason_for_miss"),
    contextualNotes: text("contextual_notes"),
    painAreas: jsonb("pain_areas").$type<PainArea[]>(),
    externalStressors: text("external_stressors").array(),
    feedbackType: text("feedback_type")
      .$type<FeedbackType>()
      .notNull()
      .default("general"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userCreatedIdx: index("workout_feedback_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
  }),
);

// ─── Coach Messages ──────────────────────────────────────────────────────────
// Stores conversational messages between the athlete and the AI coach.

export const coachMessages = pgTable(
  "coach_messages",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<"user" | "assistant">().notNull(),
    content: text("content").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userDateIdx: index("coach_messages_user_date_idx").on(
      table.userId,
      table.createdAt,
    ),
  }),
);
