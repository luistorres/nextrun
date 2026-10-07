/**
 * Imports data from Garmin Connect (unofficial API) and stores it in our
 * database using the same upsert functions as the webhook handlers.
 *
 * This is a pull-based alternative to Garmin Health API webhooks, useful
 * when you don't have official API credentials.
 */

import type { GarminConnect } from "garmin-connect";
import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  upsertDailySummary,
  upsertSleepRecord,
  upsertHrvRecord,
  upsertStressRecord,
} from "@/lib/db/queries/health";
import {
  upsertActivity,
  getExistingGarminActivityIds,
} from "@/lib/db/queries/activities";
import { matchActivityToWorkout } from "@/lib/garmin/webhooks/activity-matcher";
import {
  extractRunningDynamics,
  mapSplitLaps,
} from "@/lib/garmin/connect-mappers";
import { enqueueConnectFitDownload } from "@/lib/queue/producer";
import type { dailySummaries } from "@/lib/db/schema/health";
import { activities, activityLaps } from "@/lib/db/schema/activities";
import { format, subDays, addDays, isBefore } from "date-fns";

const CONNECT_API_BASE = "https://connectapi.garmin.com";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ImportResult {
  activities: number;
  newActivities: number;
  matchedWorkouts: number;
  dailySummaries: number;
  sleep: number;
  hrv: number;
  stress: number;
  errors: string[];
  /** Active plan ID if any activity matched a planned workout */
  _planId: string | null;
  /** Last genuinely new activity ID for adaptation triggering */
  _lastNewActivityId: string | null;
}

// ─── Main Import Function ──────────────────────────────────────────────────

/**
 * Import recent data from Garmin Connect for a user.
 * Pulls activities, daily summaries, sleep, HRV, and stress data.
 *
 * @param client - Authenticated GarminConnect client
 * @param userId - Internal user ID
 * @param days - Number of days to look back (default 30)
 */
export async function importRecentData(
  client: GarminConnect,
  userId: string,
  days = 30,
): Promise<ImportResult> {
  const result: ImportResult = {
    activities: 0,
    newActivities: 0,
    matchedWorkouts: 0,
    dailySummaries: 0,
    sleep: 0,
    hrv: 0,
    stress: 0,
    errors: [],
    _planId: null,
    _lastNewActivityId: null,
  };

  const today = new Date();
  const startDate = subDays(today, days);

  // Import activities first (built-in method, most reliable)
  await importActivities(client, userId, result);

  // Import day-by-day health data with small delays to avoid rate limiting
  const profile = await client.getUserProfile();
  const displayName = profile?.displayName;

  let current = startDate;
  while (isBefore(current, addDays(today, 1))) {
    const dateStr = format(current, "yyyy-MM-dd");
    const dateObj = current;

    await Promise.allSettled([
      importDailySummary(client, userId, dateStr, displayName, result),
      importSleep(client, userId, dateObj, result),
      importHRV(client, userId, dateStr, result),
      importStress(client, userId, dateStr, result),
    ]);

    // Small delay between days to avoid rate limiting
    await sleep(200);
    current = addDays(current, 1);
  }

  // Backfill VO2 Max from activities into daily summaries.
  // Garmin Connect daily summary endpoint doesn't include VO2 Max, but
  // activities do — propagate the latest per-activity VO2 Max to summaries.
  await backfillVO2MaxFromActivities(userId, result);

  return result;
}

// ─── VO2 Max Backfill ─────────────────────────────────────────────────────

async function backfillVO2MaxFromActivities(
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _result: ImportResult,
): Promise<void> {
  try {
    // Get activities with VO2 Max values, newest first
    const activitiesWithVO2 = await db
      .select({
        startTime: activities.startTime,
        vo2MaxActivity: activities.vo2MaxActivity,
      })
      .from(activities)
      .where(
        and(
          eq(activities.userId, userId),
          sql`${activities.vo2MaxActivity} IS NOT NULL`,
        ),
      )
      .orderBy(desc(activities.startTime))
      .limit(50);

    for (const act of activitiesWithVO2) {
      if (!act.vo2MaxActivity) continue;
      const dateStr = format(act.startTime, "yyyy-MM-dd");

      // Update the daily summary for this activity's date with the VO2 Max
      await upsertDailySummary({
        userId,
        calendarDate: dateStr,
        vo2Max: act.vo2MaxActivity,
      });
    }
  } catch {
    // Non-critical — don't fail import on VO2 Max backfill errors
  }
}

// ─── Activities ────────────────────────────────────────────────────────────

async function importActivities(
  client: GarminConnect,
  userId: string,
  result: ImportResult,
): Promise<void> {
  try {
    // Fetch up to 50 recent activities
    const rawActivities = await client.getActivities(0, 50);
    if (!rawActivities || !Array.isArray(rawActivities)) return;

    // Pre-fetch existing garmin IDs so we can tell new vs re-synced activities
    const existingIds = await getExistingGarminActivityIds(userId);

    for (const raw of rawActivities) {
      try {
        const garminId = String(raw.activityId);
        const isNew = !existingIds.has(garminId);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mapped = mapConnectActivity(userId, raw as any);
        const saved = await upsertActivity(mapped);
        result.activities++;

        if (isNew) {
          result.newActivities++;
          result._lastNewActivityId = saved.id;

          // Only match new activities — already-synced ones were matched before
          try {
            const match = await matchActivityToWorkout(
              userId,
              saved.id,
              saved.activityType,
              saved.startTime,
            );
            if (match.matched) {
              result.matchedWorkouts++;
              if (match.planId) result._planId = match.planId;
            }
          } catch {
            // Don't fail import on matching errors
          }

          // Runs only: pull lap splits + enqueue the original-FIT download.
          // Restricted to genuinely new activities to limit API calls.
          if (saved.activityType === "run") {
            await importLapsFromSplits(client, garminId, saved.id);

            // FIT decode later replaces the splits-JSON laps with richer
            // ones and fills dynamics the summary payload may lack.
            try {
              await enqueueConnectFitDownload({
                userId,
                activityId: saved.id,
                garminActivityId: garminId,
              });
            } catch {
              // Queue unavailable — non-fatal, summary data is already stored
            }
          }
        }
      } catch (e) {
        result.errors.push(`Activity ${raw.activityId}: ${String(e)}`);
      }
    }
  } catch (e) {
    result.errors.push(`Activities fetch: ${String(e)}`);
  }
}

// ─── Laps (splits endpoint) ────────────────────────────────────────────────

/** Log the unexpected-shape warning only once per process (shapes don't
 * change per-activity, so repeating it for every run is pure noise). */
let splitsShapeWarned = false;

/**
 * Fetch the unofficial splits endpoint for an activity and replace its laps
 * (delete + insert, same convention as the FIT decode path — which later
 * overrides these rows with richer FIT-derived laps).
 *
 * Defensive: any error or unexpected payload shape skips silently (the
 * shape warning is logged once per process).
 */
async function importLapsFromSplits(
  client: GarminConnect,
  garminActivityId: string,
  activityId: string,
): Promise<void> {
  try {
    // Same pacing convention as the day-by-day health imports above
    await sleep(200);

    const raw = await client.get<unknown>(
      `${CONNECT_API_BASE}/activity-service/activity/${garminActivityId}/splits`,
    );

    const laps = mapSplitLaps(raw);
    if (laps === null) {
      if (!splitsShapeWarned) {
        splitsShapeWarned = true;
        console.warn(
          "[garmin-connect] Unexpected splits payload shape — skipping laps import",
          { garminActivityId },
        );
      }
      return;
    }
    if (laps.length === 0) return;

    const lapRows = laps.map((lap) => ({ ...lap, activityId }));
    await db.transaction(async (tx) => {
      await tx.delete(activityLaps).where(eq(activityLaps.activityId, activityId));
      await tx.insert(activityLaps).values(lapRows);
    });
  } catch {
    // Laps are an enhancement — never fail the import over them
  }
}

// ─── Daily Summary ─────────────────────────────────────────────────────────

async function importDailySummary(
  client: GarminConnect,
  userId: string,
  dateStr: string,
  displayName: string | undefined,
  result: ImportResult,
): Promise<void> {
  try {
    // Daily summary requires displayName and uses a custom endpoint
    if (!displayName) return;

    const raw = await client.get<Record<string, unknown>>(
      `${CONNECT_API_BASE}/usersummary-service/usersummary/daily/${displayName}?calendarDate=${dateStr}`,
    );
    if (!raw) return;

    const mapped: typeof dailySummaries.$inferInsert = {
      userId,
      calendarDate: dateStr,
      steps: toInt(raw.totalSteps),
      distanceMeters: toStr(raw.totalDistanceMeters),
      activeSeconds: toInt(raw.activeSeconds ?? raw.highlyActiveSeconds),
      restingHeartRate: toInt(raw.restingHeartRate),
      minHeartRate: toInt(raw.minHeartRate),
      maxHeartRate: toInt(raw.maxHeartRate),
      averageStressLevel: toInt(raw.averageStressLevel),
      bodyBatteryStart: toInt(raw.bodyBatteryHighestValue ?? raw.highBodyBattery),
      bodyBatteryEnd: toInt(raw.bodyBatteryMostRecentValue ?? raw.endingBodyBatteryInBodyBattery),
      vo2Max: null, // Not in daily summary endpoint
      respirationAvg: toStr(raw.averageSpo2 ?? raw.avgWakingRespirationValue),
      rawJson: raw as unknown as typeof dailySummaries.$inferInsert["rawJson"],
    };

    await upsertDailySummary(mapped);
    result.dailySummaries++;
  } catch {
    // Silently skip — some dates may not have data
  }
}

// ─── Sleep ─────────────────────────────────────────────────────────────────

async function importSleep(
  client: GarminConnect,
  userId: string,
  date: Date,
  result: ImportResult,
): Promise<void> {
  try {
    const raw = await client.getSleepData(date);
    if (!raw?.dailySleepDTO) return;

    const s = raw.dailySleepDTO as unknown as Record<string, unknown>;
    const calendarDate = (s.calendarDate as string) ?? format(date, "yyyy-MM-dd");

    await upsertSleepRecord({
      userId,
      calendarDate,
      totalSleepSeconds: toInt(s.sleepTimeSeconds),
      deepSleepSeconds: toInt(s.deepSleepSeconds),
      lightSleepSeconds: toInt(s.lightSleepSeconds),
      remSleepSeconds: toInt(s.remSleepSeconds),
      awakeSeconds: toInt(s.awakeSleepSeconds),
      sleepScore: toInt((s.sleepScores as Record<string, unknown>)?.overall
        ? ((s.sleepScores as Record<string, Record<string, unknown>>).overall.value)
        : null),
      startTime: s.sleepStartTimestampGMT
        ? new Date(s.sleepStartTimestampGMT as number)
        : null,
      endTime: s.sleepEndTimestampGMT
        ? new Date(s.sleepEndTimestampGMT as number)
        : null,
      rawJson: raw as unknown as typeof import("@/lib/db/schema/health").sleepRecords.$inferInsert["rawJson"],
    });
    result.sleep++;
  } catch {
    // Silently skip
  }
}

// ─── HRV ───────────────────────────────────────────────────────────────────

async function importHRV(
  client: GarminConnect,
  userId: string,
  dateStr: string,
  result: ImportResult,
): Promise<void> {
  try {
    const raw = await client.get<Record<string, unknown>>(
      `${CONNECT_API_BASE}/hrv-service/hrv/${dateStr}`,
    );
    if (!raw) return;

    // HRV data can be in different shapes depending on the endpoint version
    const summary = (raw.hrvSummary ?? raw) as Record<string, unknown>;

    await upsertHrvRecord({
      userId,
      calendarDate: (summary.calendarDate as string) ?? dateStr,
      hrvWeeklyAvg: toStr(summary.weeklyAvg ?? summary.baselineLowUpper),
      hrvLastNight: toStr(summary.lastNight ?? summary.lastNightAvg),
      hrvStatus: (summary.status as string) ?? null,
      rawJson: raw as unknown as typeof import("@/lib/db/schema/health").hrvRecords.$inferInsert["rawJson"],
    });
    result.hrv++;
  } catch {
    // Silently skip
  }
}

// ─── Stress ────────────────────────────────────────────────────────────────

async function importStress(
  client: GarminConnect,
  userId: string,
  dateStr: string,
  result: ImportResult,
): Promise<void> {
  try {
    const raw = await client.get<Record<string, unknown>>(
      `${CONNECT_API_BASE}/wellness-service/wellness/dailyStress/${dateStr}`,
    );
    if (!raw) return;

    // Map stress values from Garmin Connect format
    const stressValuesRaw = raw.stressValuesArray as number[][] | undefined;
    const stressValues = stressValuesRaw?.map(([timestamp, value]) => ({
      timestamp,
      value,
    })) ?? null;

    await upsertStressRecord({
      userId,
      calendarDate: (raw.calendarDate as string) ?? dateStr,
      stressValues,
      avgStress: toInt(raw.overallStressLevel ?? raw.averageStressLevel),
      maxStress: toInt(raw.maxStressLevel),
      restStressDurationSeconds: toInt(raw.restStressDuration),
      activityStressDurationSeconds: toInt(raw.activityStressDuration),
      highStressDurationSeconds: toInt(raw.highStressDuration),
      rawJson: raw as unknown as typeof import("@/lib/db/schema/health").stressRecords.$inferInsert["rawJson"],
    });
    result.stress++;
  } catch {
    // Silently skip
  }
}

// ─── Activity Mapper ──────────────────────────────────────────────────────

function mapConnectActivity(
  userId: string,
  raw: Record<string, unknown>,
): typeof activities.$inferInsert {
  // startTimeLocal is "YYYY-MM-DD HH:mm:ss" (space-separated, no T)
  const startTime = raw.startTimeLocal
    ? new Date((raw.startTimeLocal as string).replace(" ", "T"))
    : new Date((raw.beginTimestamp as number) ?? Date.now());

  // Compute pace from speed (m/s → sec/km)
  const speed = raw.averageSpeed as number | undefined;
  let avgPaceSecondsPerKm: string | null = null;
  if (speed && speed > 0) {
    avgPaceSecondsPerKm = (1000 / speed).toFixed(1);
  }

  return {
    userId,
    garminActivityId: String(raw.activityId),
    activityType: normalizeActivityType(
      typeof raw.activityType === "object" && raw.activityType !== null
        ? (raw.activityType as Record<string, unknown>).typeKey as string | undefined
        : raw.activityType as string | undefined,
    ),
    startTime,
    durationSeconds: Math.round((raw.duration as number) ?? 0),
    distanceMeters: toStr(raw.distance),
    avgHeartRate: toInt(raw.averageHR),
    maxHeartRate: toInt(raw.maxHR),
    avgPaceSecondsPerKm,
    elevationGainMeters: toStr(raw.elevationGain),
    calories: toInt(raw.calories),
    trainingEffectAerobic: toStr(raw.aerobicTrainingEffect),
    trainingEffectAnaerobic: toStr(raw.anaerobicTrainingEffect),
    vo2MaxActivity: toStr(raw.vO2MaxValue),
    // Running dynamics / training load / lactate threshold from the summary
    // payload (nullable, unit conversions in connect-mappers.ts). Re-imports
    // never clobber non-null values: upsertActivity coalesces these columns.
    ...extractRunningDynamics(raw),
    wasPlanned: false,
    plannedWorkoutId: null,
    rawJson: raw as unknown as typeof activities.$inferInsert["rawJson"],
  };
}

// ─── Activity Type Normalization ──────────────────────────────────────────

function normalizeActivityType(garminType: string | undefined): string {
  if (!garminType) return "other";

  const typeMap: Record<string, string> = {
    running: "run",
    trail_running: "run",
    treadmill_running: "run",
    track_running: "run",
    cycling: "cycle",
    mountain_biking: "cycle",
    indoor_cycling: "cycle",
    swimming: "swim",
    lap_swimming: "swim",
    open_water_swimming: "swim",
    strength_training: "strength",
    walking: "walk",
    hiking: "hike",
    yoga: "yoga",
    paddelball: "padel",
    padel: "padel",
    hiit: "hiit",
    kitesurfing: "kitesurf",
    kite_surfing: "kitesurf",
    wind_kite_surfing: "kitesurf",
    pilates: "yoga",
  };

  // Garmin Connect uses different casing than the Health API
  const key = garminType.toLowerCase().replace(/\s+/g, "_");
  return typeMap[key] ?? "other";
}

// ─── Utility Helpers ──────────────────────────────────────────────────────

function toInt(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function toStr(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return Number.isFinite(n) ? String(n) : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
