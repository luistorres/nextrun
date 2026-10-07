/**
 * 7-day vs 28-day trend comparison.
 *
 * For each key health metric, compares the 7-day average against the
 * 28-day baseline to determine direction and magnitude of change.
 */

import type { Database } from "@/lib/db";
import type { MetricsTrend, TrendDirection } from "@/types/metrics";
import { eq, and, between, desc } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { subDays, format } from "date-fns";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Change above this threshold is considered improving or declining */
const CHANGE_THRESHOLD_PERCENT = 5;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Calculate trends for all key metrics: 7-day avg vs 28-day avg.
 *
 * @param db - Database instance
 * @param userId - The user to calculate trends for
 * @param asOf - The reference date (defaults to today)
 * @returns Array of MetricsTrend objects for each metric that has data
 */
export async function calculateTrends(
  db: Database,
  userId: string,
  asOf: Date = new Date(),
): Promise<MetricsTrend[]> {
  const todayStr = format(asOf, "yyyy-MM-dd");
  const sevenDaysAgo = format(subDays(asOf, 7), "yyyy-MM-dd");
  const twentyEightDaysAgo = format(subDays(asOf, 28), "yyyy-MM-dd");

  // Fetch 28 days of data (the 7-day window is a subset)
  const [dailySummaries, sleepRecords, hrvRecords, stressRecords] =
    await Promise.all([
      db
        .select()
        .from(schema.dailySummaries)
        .where(
          and(
            eq(schema.dailySummaries.userId, userId),
            between(
              schema.dailySummaries.calendarDate,
              twentyEightDaysAgo,
              todayStr,
            ),
          ),
        )
        .orderBy(desc(schema.dailySummaries.calendarDate)),
      db
        .select()
        .from(schema.sleepRecords)
        .where(
          and(
            eq(schema.sleepRecords.userId, userId),
            between(
              schema.sleepRecords.calendarDate,
              twentyEightDaysAgo,
              todayStr,
            ),
          ),
        )
        .orderBy(desc(schema.sleepRecords.calendarDate)),
      db
        .select()
        .from(schema.hrvRecords)
        .where(
          and(
            eq(schema.hrvRecords.userId, userId),
            between(
              schema.hrvRecords.calendarDate,
              twentyEightDaysAgo,
              todayStr,
            ),
          ),
        )
        .orderBy(desc(schema.hrvRecords.calendarDate)),
      db
        .select()
        .from(schema.stressRecords)
        .where(
          and(
            eq(schema.stressRecords.userId, userId),
            between(
              schema.stressRecords.calendarDate,
              twentyEightDaysAgo,
              todayStr,
            ),
          ),
        )
        .orderBy(desc(schema.stressRecords.calendarDate)),
    ]);

  // Split each dataset into 7d and 28d windows
  const split = <T extends { calendarDate: string }>(data: T[]) => {
    const recent = data.filter((d) => d.calendarDate >= sevenDaysAgo);
    return { recent7d: recent, all28d: data };
  };

  const dailySplit = split(dailySummaries);
  const sleepSplit = split(sleepRecords);
  const hrvSplit = split(hrvRecords);
  const stressSplit = split(stressRecords);

  const trends: MetricsTrend[] = [];

  // ── HRV ────────────────────────────────────────────────────────────────
  const hrvTrend = buildTrend(
    "hrv",
    hrvSplit.recent7d
      .map((h) =>
        h.hrvWeeklyAvg ? parseFloat(String(h.hrvWeeklyAvg)) : null,
      )
      .filter(nonNull),
    hrvSplit.all28d
      .map((h) =>
        h.hrvWeeklyAvg ? parseFloat(String(h.hrvWeeklyAvg)) : null,
      )
      .filter(nonNull),
    "higher_is_better",
  );
  if (hrvTrend) trends.push(hrvTrend);

  // ── Sleep Score ────────────────────────────────────────────────────────
  const sleepTrend = buildTrend(
    "sleepScore",
    sleepSplit.recent7d.map((s) => s.sleepScore).filter(nonNull),
    sleepSplit.all28d.map((s) => s.sleepScore).filter(nonNull),
    "higher_is_better",
  );
  if (sleepTrend) trends.push(sleepTrend);

  // ── Resting HR ─────────────────────────────────────────────────────────
  const restingHRTrend = buildTrend(
    "restingHR",
    dailySplit.recent7d.map((d) => d.restingHeartRate).filter(nonNull),
    dailySplit.all28d.map((d) => d.restingHeartRate).filter(nonNull),
    "lower_is_better",
  );
  if (restingHRTrend) trends.push(restingHRTrend);

  // ── Stress ─────────────────────────────────────────────────────────────
  const stressTrend = buildTrend(
    "stress",
    stressSplit.recent7d.map((s) => s.avgStress).filter(nonNull),
    stressSplit.all28d.map((s) => s.avgStress).filter(nonNull),
    "lower_is_better",
  );
  if (stressTrend) trends.push(stressTrend);

  // ── Body Battery ───────────────────────────────────────────────────────
  const bodyBatteryTrend = buildTrend(
    "bodyBattery",
    dailySplit.recent7d.map((d) => d.bodyBatteryStart).filter(nonNull),
    dailySplit.all28d.map((d) => d.bodyBatteryStart).filter(nonNull),
    "higher_is_better",
  );
  if (bodyBatteryTrend) trends.push(bodyBatteryTrend);

  return trends;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Polarity = "higher_is_better" | "lower_is_better";

function buildTrend(
  metric: string,
  recent7d: number[],
  all28d: number[],
  polarity: Polarity,
): MetricsTrend | null {
  if (recent7d.length === 0 || all28d.length === 0) return null;

  const avg7d = average(recent7d);
  const avg28d = average(all28d);

  if (avg28d === 0) return null;

  const changePercent = ((avg7d - avg28d) / avg28d) * 100;
  const absChange = Math.abs(changePercent);

  let direction: TrendDirection;
  if (absChange < CHANGE_THRESHOLD_PERCENT) {
    direction = "stable";
  } else if (changePercent > 0) {
    direction = "up";
  } else {
    direction = "down";
  }

  // Determine whether this trend is positive, negative, or neutral
  let flag: MetricsTrend["flag"];
  if (direction === "stable") {
    flag = "neutral";
  } else if (polarity === "higher_is_better") {
    flag = direction === "up" ? "positive" : "negative";
  } else {
    // lower_is_better: going down is good, going up is bad
    flag = direction === "down" ? "positive" : "negative";
  }

  return {
    metric,
    current7dAvg: round2(avg7d),
    baseline28dAvg: round2(avg28d),
    direction,
    changePercent: round2(changePercent),
    flag,
  };
}

function nonNull<T>(value: T | null | undefined): value is T {
  return value != null;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
