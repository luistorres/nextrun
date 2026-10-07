import { eq, and, between, desc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  dailySummaries,
  sleepRecords,
  hrvRecords,
  stressRecords,
} from "@/lib/db/schema";

// ─── Daily Summaries ────────────────────────────────────────────────────────

export async function upsertDailySummary(
  data: typeof dailySummaries.$inferInsert
) {
  const [result] = await db
    .insert(dailySummaries)
    .values(data)
    .onConflictDoUpdate({
      target: [dailySummaries.userId, dailySummaries.calendarDate],
      set: {
        steps: data.steps,
        distanceMeters: data.distanceMeters,
        activeSeconds: data.activeSeconds,
        restingHeartRate: data.restingHeartRate,
        minHeartRate: data.minHeartRate,
        maxHeartRate: data.maxHeartRate,
        averageStressLevel: data.averageStressLevel,
        bodyBatteryStart: data.bodyBatteryStart,
        bodyBatteryEnd: data.bodyBatteryEnd,
        vo2Max:
          data.vo2Max != null
            ? data.vo2Max
            : sql`${dailySummaries.vo2Max}`,
        respirationAvg: data.respirationAvg,
        rawJson: data.rawJson,
      },
    })
    .returning();
  return result;
}

export async function getDailySummariesByRange(
  userId: string,
  startDate: string,
  endDate: string
) {
  return db
    .select()
    .from(dailySummaries)
    .where(
      and(
        eq(dailySummaries.userId, userId),
        between(dailySummaries.calendarDate, startDate, endDate)
      )
    )
    .orderBy(desc(dailySummaries.calendarDate));
}

export async function getLatestDailySummary(userId: string) {
  const [result] = await db
    .select()
    .from(dailySummaries)
    .where(eq(dailySummaries.userId, userId))
    .orderBy(desc(dailySummaries.calendarDate))
    .limit(1);
  return result ?? null;
}

// ─── Sleep Records ──────────────────────────────────────────────────────────

export async function upsertSleepRecord(
  data: typeof sleepRecords.$inferInsert
) {
  const [result] = await db
    .insert(sleepRecords)
    .values(data)
    .onConflictDoUpdate({
      target: [sleepRecords.userId, sleepRecords.calendarDate],
      set: {
        totalSleepSeconds: data.totalSleepSeconds,
        deepSleepSeconds: data.deepSleepSeconds,
        lightSleepSeconds: data.lightSleepSeconds,
        remSleepSeconds: data.remSleepSeconds,
        awakeSeconds: data.awakeSeconds,
        sleepScore: data.sleepScore,
        startTime: data.startTime,
        endTime: data.endTime,
        rawJson: data.rawJson,
      },
    })
    .returning();
  return result;
}

export async function getSleepRecordsByRange(
  userId: string,
  startDate: string,
  endDate: string
) {
  return db
    .select()
    .from(sleepRecords)
    .where(
      and(
        eq(sleepRecords.userId, userId),
        between(sleepRecords.calendarDate, startDate, endDate)
      )
    )
    .orderBy(desc(sleepRecords.calendarDate));
}

// ─── HRV Records ────────────────────────────────────────────────────────────

export async function upsertHrvRecord(data: typeof hrvRecords.$inferInsert) {
  const [result] = await db
    .insert(hrvRecords)
    .values(data)
    .onConflictDoUpdate({
      target: [hrvRecords.userId, hrvRecords.calendarDate],
      set: {
        hrvWeeklyAvg: data.hrvWeeklyAvg,
        hrvLastNight: data.hrvLastNight,
        hrvStatus: data.hrvStatus,
        rawJson: data.rawJson,
      },
    })
    .returning();
  return result;
}

export async function getHrvRecordsByRange(
  userId: string,
  startDate: string,
  endDate: string
) {
  return db
    .select()
    .from(hrvRecords)
    .where(
      and(
        eq(hrvRecords.userId, userId),
        between(hrvRecords.calendarDate, startDate, endDate)
      )
    )
    .orderBy(desc(hrvRecords.calendarDate));
}

// ─── Stress Records ─────────────────────────────────────────────────────────

export async function upsertStressRecord(
  data: typeof stressRecords.$inferInsert
) {
  const [result] = await db
    .insert(stressRecords)
    .values(data)
    .onConflictDoUpdate({
      target: [stressRecords.userId, stressRecords.calendarDate],
      set: {
        stressValues: data.stressValues,
        avgStress: data.avgStress,
        maxStress: data.maxStress,
        restStressDurationSeconds: data.restStressDurationSeconds,
        activityStressDurationSeconds: data.activityStressDurationSeconds,
        highStressDurationSeconds: data.highStressDurationSeconds,
        rawJson: data.rawJson,
      },
    })
    .returning();
  return result;
}

export async function getStressRecordsByRange(
  userId: string,
  startDate: string,
  endDate: string
) {
  return db
    .select()
    .from(stressRecords)
    .where(
      and(
        eq(stressRecords.userId, userId),
        between(stressRecords.calendarDate, startDate, endDate)
      )
    )
    .orderBy(desc(stressRecords.calendarDate));
}

// ─── Aggregated Health Snapshot ─────────────────────────────────────────────

export async function getHealthDataByRange(
  userId: string,
  startDate: string,
  endDate: string
) {
  const [summaries, sleep, hrv, stress] = await Promise.all([
    getDailySummariesByRange(userId, startDate, endDate),
    getSleepRecordsByRange(userId, startDate, endDate),
    getHrvRecordsByRange(userId, startDate, endDate),
    getStressRecordsByRange(userId, startDate, endDate),
  ]);

  return { summaries, sleep, hrv, stress };
}
