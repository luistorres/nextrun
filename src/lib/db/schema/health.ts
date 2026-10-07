import {
  pgTable,
  text,
  integer,
  numeric,
  date,
  timestamp,
  jsonb,
  uuid,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./auth";
import type {
  GarminDailySummary,
  GarminSleep,
  GarminHRV,
  GarminStress,
} from "@/types/garmin";

// ─── Daily Summaries ────────────────────────────────────────────────────────
// Aggregated daily health metrics from Garmin Health API.
// One row per user per calendar date.

export const dailySummaries = pgTable(
  "daily_summaries",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    calendarDate: date("calendar_date").notNull(),
    steps: integer("steps"),
    distanceMeters: numeric("distance_meters"),
    activeSeconds: integer("active_seconds"),
    restingHeartRate: integer("resting_heart_rate"),
    minHeartRate: integer("min_heart_rate"),
    maxHeartRate: integer("max_heart_rate"),
    averageStressLevel: integer("average_stress_level"),
    bodyBatteryStart: integer("body_battery_start"),
    bodyBatteryEnd: integer("body_battery_end"),
    vo2Max: numeric("vo2_max"),
    respirationAvg: numeric("respiration_avg"),
    rawJson: jsonb("raw_json").$type<GarminDailySummary>(),
  },
  (table) => ({
    userDateIdx: uniqueIndex("daily_summaries_user_date_idx").on(
      table.userId,
      table.calendarDate
    ),
  })
);

// ─── Sleep Records ──────────────────────────────────────────────────────────
// Nightly sleep data from Garmin Health API.

export const sleepRecords = pgTable(
  "sleep_records",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    calendarDate: date("calendar_date").notNull(),
    totalSleepSeconds: integer("total_sleep_seconds"),
    deepSleepSeconds: integer("deep_sleep_seconds"),
    lightSleepSeconds: integer("light_sleep_seconds"),
    remSleepSeconds: integer("rem_sleep_seconds"),
    awakeSeconds: integer("awake_seconds"),
    sleepScore: integer("sleep_score"),
    startTime: timestamp("start_time", { withTimezone: true }),
    endTime: timestamp("end_time", { withTimezone: true }),
    rawJson: jsonb("raw_json").$type<GarminSleep>(),
  },
  (table) => ({
    userDateIdx: uniqueIndex("sleep_records_user_date_idx").on(
      table.userId,
      table.calendarDate
    ),
  })
);

// ─── HRV Records ────────────────────────────────────────────────────────────
// Heart Rate Variability data from Garmin Health API.

export const hrvRecords = pgTable(
  "hrv_records",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    calendarDate: date("calendar_date").notNull(),
    hrvWeeklyAvg: numeric("hrv_weekly_avg"),
    hrvLastNight: numeric("hrv_last_night"),
    hrvStatus: text("hrv_status"),
    rawJson: jsonb("raw_json").$type<GarminHRV>(),
  },
  (table) => ({
    userDateIdx: uniqueIndex("hrv_records_user_date_idx").on(
      table.userId,
      table.calendarDate
    ),
  })
);

// ─── Stress Records ─────────────────────────────────────────────────────────
// Stress level data from Garmin Health API.

export interface StressValue {
  timestamp: number;
  value: number;
}

export const stressRecords = pgTable(
  "stress_records",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    calendarDate: date("calendar_date").notNull(),
    stressValues: jsonb("stress_values").$type<StressValue[]>(),
    avgStress: integer("avg_stress"),
    maxStress: integer("max_stress"),
    restStressDurationSeconds: integer("rest_stress_duration_seconds"),
    activityStressDurationSeconds: integer("activity_stress_duration_seconds"),
    highStressDurationSeconds: integer("high_stress_duration_seconds"),
    rawJson: jsonb("raw_json").$type<GarminStress>(),
  },
  (table) => ({
    userDateIdx: uniqueIndex("stress_records_user_date_idx").on(
      table.userId,
      table.calendarDate
    ),
  })
);
