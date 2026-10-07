import {
  pgTable,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  jsonb,
  uuid,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./auth";
import { shoes } from "./gear";
import type { GarminActivity } from "@/types/garmin";

// Forward-reference: planned_workouts FK is set up in relations.ts
// to avoid circular imports. The column is defined here as a plain uuid.

// ─── Activities ─────────────────────────────────────────────────────────────
// Completed activities synced from Garmin Activity API.
// Each Garmin activity maps to exactly one row via garmin_activity_id.

export const activities = pgTable(
  "activities",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    garminActivityId: text("garmin_activity_id").unique(),
    activityType: text("activity_type").notNull(),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    durationSeconds: integer("duration_seconds").notNull(),
    distanceMeters: numeric("distance_meters"),
    avgHeartRate: integer("avg_heart_rate"),
    maxHeartRate: integer("max_heart_rate"),
    avgPaceSecondsPerKm: numeric("avg_pace_seconds_per_km"),
    elevationGainMeters: numeric("elevation_gain_meters"),
    calories: integer("calories"),
    trainingEffectAerobic: numeric("training_effect_aerobic"),
    trainingEffectAnaerobic: numeric("training_effect_anaerobic"),
    vo2MaxActivity: numeric("vo2_max_activity"),
    /** Average run cadence in steps/min (both feet) — Garmin summary field */
    avgRunCadence: numeric("avg_run_cadence"),
    /** Max run cadence in steps/min */
    maxRunCadence: numeric("max_run_cadence"),
    /** Garmin's own EPOC-based session load (Firstbeat) when provided */
    activityTrainingLoad: numeric("activity_training_load"),
    wasPlanned: boolean("was_planned").notNull().default(false),
    plannedWorkoutId: uuid("planned_workout_id"),
    /** Manually assigned shoe (Garmin's partner API does not expose gear). */
    shoeId: uuid("shoe_id").references(() => shoes.id, {
      onDelete: "set null",
    }),
    /** Rate of Perceived Exertion (Borg CR-10 scale, 1–10). Set by athlete post-session. */
    rpeScore: integer("rpe_score"),
    /** Athlete's qualitative difficulty assessment for the session. */
    perceivedDifficulty: text("perceived_difficulty"),
    fitFilePath: text("fit_file_path"),
    // ── Running dynamics (decoded from the FIT session message) ──────────
    /** Average ground contact time in milliseconds (FIT avg_stance_time) */
    avgGroundContactTimeMs: numeric("avg_ground_contact_time_ms"),
    /** Average vertical oscillation in millimeters */
    avgVerticalOscillationMm: numeric("avg_vertical_oscillation_mm"),
    /** Average vertical ratio (oscillation / stride length) in percent */
    avgVerticalRatioPct: numeric("avg_vertical_ratio_pct"),
    /** Average stride length in meters (FIT avg_step_length, mm → m) */
    avgStrideLengthM: numeric("avg_stride_length_m"),
    /** Lactate threshold heart rate in bpm (FIT session / zones_target) */
    lactateThresholdHeartRate: integer("lactate_threshold_heart_rate"),
    /** Lactate threshold pace in meters per second */
    lactateThresholdPaceMps: numeric("lactate_threshold_pace_mps"),
    /** When the stored FIT binary was last decoded into laps/dynamics */
    fitDecodedAt: timestamp("fit_decoded_at", { withTimezone: true }),
    rawJson: jsonb("raw_json").$type<GarminActivity>(),
  },
  (table) => ({
    userStartTimeIdx: index("activities_user_start_time_idx").on(
      table.userId,
      table.startTime
    ),
    garminActivityIdIdx: uniqueIndex("activities_garmin_activity_id_idx").on(
      table.garminActivityId
    ),
  })
);

// ─── Activity Laps ──────────────────────────────────────────────────────────
// Per-lap metrics decoded from the stored FIT binary (see
// src/lib/garmin/fit-decoder.ts). Laps are replaced wholesale (delete+insert
// by activityId) every time the FIT file is (re)decoded.

export const activityLaps = pgTable(
  "activity_laps",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    activityId: uuid("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    /** 0-based position of the lap within the activity */
    lapIndex: integer("lap_index").notNull(),
    /** Lap start as unix epoch seconds */
    startTimeInSeconds: integer("start_time_in_seconds"),
    totalDistanceMeters: numeric("total_distance_meters"),
    totalTimerTimeSeconds: numeric("total_timer_time_seconds"),
    avgSpeedMps: numeric("avg_speed_mps"),
    avgHeartRate: integer("avg_heart_rate"),
    maxHeartRate: integer("max_heart_rate"),
    /** Average run cadence in steps/min (both feet), matching activities.avgRunCadence */
    avgRunCadence: numeric("avg_run_cadence"),
    /** Derived from avgSpeedMps (1000 / speed) */
    avgPaceSecondsPerKm: numeric("avg_pace_seconds_per_km"),
    totalAscentMeters: numeric("total_ascent_meters"),
  },
  (table) => ({
    activityLapIdx: uniqueIndex("activity_laps_activity_lap_idx").on(
      table.activityId,
      table.lapIndex
    ),
  })
);
