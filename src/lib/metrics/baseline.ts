/**
 * 28-day rolling baseline calculator.
 *
 * Computes average values for key health metrics from the last 28 days
 * of Garmin health data. Returns null for any metric that has no data.
 */

import type { Database } from "@/lib/db";
import type { MetricsBaseline } from "@/types/metrics";
import { eq, and, between, desc } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { subDays, format } from "date-fns";

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Calculate a 28-day rolling baseline for a user.
 *
 * @param db - Database instance (app or worker)
 * @param userId - The user to calculate baselines for
 * @param asOf - The reference date (defaults to today)
 */
export async function calculateBaseline(
  db: Database,
  userId: string,
  asOf: Date = new Date(),
): Promise<MetricsBaseline> {
  const toDate = format(asOf, "yyyy-MM-dd");
  const fromDate = format(subDays(asOf, 28), "yyyy-MM-dd");

  // Fetch all relevant health data in parallel
  const [dailySummaries, sleepRecords, hrvRecords, stressRecords] =
    await Promise.all([
      db
        .select()
        .from(schema.dailySummaries)
        .where(
          and(
            eq(schema.dailySummaries.userId, userId),
            between(schema.dailySummaries.calendarDate, fromDate, toDate),
          ),
        )
        .orderBy(desc(schema.dailySummaries.calendarDate)),
      db
        .select()
        .from(schema.sleepRecords)
        .where(
          and(
            eq(schema.sleepRecords.userId, userId),
            between(schema.sleepRecords.calendarDate, fromDate, toDate),
          ),
        )
        .orderBy(desc(schema.sleepRecords.calendarDate)),
      db
        .select()
        .from(schema.hrvRecords)
        .where(
          and(
            eq(schema.hrvRecords.userId, userId),
            between(schema.hrvRecords.calendarDate, fromDate, toDate),
          ),
        )
        .orderBy(desc(schema.hrvRecords.calendarDate)),
      db
        .select()
        .from(schema.stressRecords)
        .where(
          and(
            eq(schema.stressRecords.userId, userId),
            between(schema.stressRecords.calendarDate, fromDate, toDate),
          ),
        )
        .orderBy(desc(schema.stressRecords.calendarDate)),
    ]);

  // Compute averages, returning null when no data exists
  const hrvValues = hrvRecords
    .map((h) => (h.hrvWeeklyAvg ? parseFloat(String(h.hrvWeeklyAvg)) : null))
    .filter(nonNull);

  const sleepScoreValues = sleepRecords
    .map((s) => s.sleepScore)
    .filter(nonNull);

  const restingHRValues = dailySummaries
    .map((d) => d.restingHeartRate)
    .filter(nonNull);

  const stressValues = stressRecords.map((s) => s.avgStress).filter(nonNull);

  // Body battery: use the highest value (morning peak after sleep)
  const bodyBatteryValues = dailySummaries
    .map((d) => d.bodyBatteryStart)
    .filter(nonNull);

  const vo2MaxValues = dailySummaries
    .map((d) => (d.vo2Max != null ? parseFloat(String(d.vo2Max)) : null))
    .filter(nonNull)
    .filter((v) => v > 0);

  const dataPoints = Math.max(
    dailySummaries.length,
    sleepRecords.length,
    hrvRecords.length,
    stressRecords.length,
  );

  return {
    hrvAvg: safeAverage(hrvValues),
    sleepScoreAvg: safeAverage(sleepScoreValues),
    restingHRAvg: safeAverage(restingHRValues),
    stressAvg: safeAverage(stressValues),
    bodyBatteryStartAvg: safeAverage(bodyBatteryValues),
    vo2MaxAvg: safeAverage(vo2MaxValues),
    fromDate,
    toDate,
    dataPoints,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nonNull<T>(value: T | null | undefined): value is T {
  return value != null;
}

function safeAverage(values: number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return Math.round((sum / values.length) * 10) / 10;
}
