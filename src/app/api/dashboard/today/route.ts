import { NextResponse } from "next/server";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import {
  format,
  startOfDay,
  addDays,
  subHours,
  parseISO,
  startOfWeek,
  differenceInWeeks,
  differenceInCalendarDays,
} from "date-fns";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  activities,
  adaptations,
  dailySummaries,
  garminConnections,
  hrvRecords,
  sleepRecords,
  workoutFeedback,
} from "@/lib/db/schema";
import { getActivePlanWithWorkouts } from "@/lib/db/queries/training";
import { calculateRecoveryReadiness } from "@/lib/metrics/derived";
import { buildTomorrowPreview, toTodayWorkout } from "./tomorrow-preview";
import type {
  CompletedRunSummary,
  TodayGoalContext,
  TodayHeartbeat,
  TodayReadiness,
  TodayResponse,
  TodayWorkout,
  TomorrowPreview,
} from "@/types/dashboard";

// ---------------------------------------------------------------------------
// GET /api/dashboard/today — Discriminated "today" state for the hero card
// ---------------------------------------------------------------------------

type PlanWithWorkouts = NonNullable<
  Awaited<ReturnType<typeof getActivePlanWithWorkouts>>
>;
type PlannedWorkoutRow = PlanWithWorkouts["workouts"][number];

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    // "Today" follows the same server-side convention as the rest of the app
    // (date-fns format() on server time, UTC in deployment — see
    // /api/metrics/summary and scheduledDate comparisons). Athletes far from
    // UTC may see the day roll over a few hours early/late.
    const now = new Date();
    const today = format(now, "yyyy-MM-dd");
    const dayStart = startOfDay(now);
    const dayEnd = addDays(dayStart, 1);

    const [
      plan,
      recovery,
      todaySleepRows,
      todaySummaryRows,
      latestSummaryRows,
      latestHrvRows,
      summaryCountRows,
      connectionRows,
      todayActivities,
    ] = await Promise.all([
      getActivePlanWithWorkouts(userId),
      calculateRecoveryReadiness(db, userId, now),
      db
        .select({ totalSleepSeconds: sleepRecords.totalSleepSeconds })
        .from(sleepRecords)
        .where(
          and(
            eq(sleepRecords.userId, userId),
            eq(sleepRecords.calendarDate, today),
          ),
        )
        .limit(1),
      db
        .select({ bodyBatteryStart: dailySummaries.bodyBatteryStart })
        .from(dailySummaries)
        .where(
          and(
            eq(dailySummaries.userId, userId),
            eq(dailySummaries.calendarDate, today),
          ),
        )
        .limit(1),
      db
        .select({ calendarDate: dailySummaries.calendarDate })
        .from(dailySummaries)
        .where(eq(dailySummaries.userId, userId))
        .orderBy(desc(dailySummaries.calendarDate))
        .limit(1),
      db
        .select({ calendarDate: hrvRecords.calendarDate })
        .from(hrvRecords)
        .where(eq(hrvRecords.userId, userId))
        .orderBy(desc(hrvRecords.calendarDate))
        .limit(1),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(dailySummaries)
        .where(eq(dailySummaries.userId, userId)),
      db
        .select({ id: garminConnections.id })
        .from(garminConnections)
        .where(eq(garminConnections.userId, userId))
        .limit(1),
      db
        .select({
          id: activities.id,
          activityType: activities.activityType,
          distanceMeters: activities.distanceMeters,
          durationSeconds: activities.durationSeconds,
          avgPaceSecondsPerKm: activities.avgPaceSecondsPerKm,
          plannedWorkoutId: activities.plannedWorkoutId,
          wasPlanned: activities.wasPlanned,
          rpeScore: activities.rpeScore,
        })
        .from(activities)
        .where(
          and(
            eq(activities.userId, userId),
            gte(activities.startTime, dayStart),
            lt(activities.startTime, dayEnd),
          ),
        )
        .orderBy(desc(activities.startTime)),
    ]);

    const readiness = buildReadiness(
      recovery,
      todaySleepRows[0]?.totalSleepSeconds ?? null,
      todaySummaryRows[0]?.bodyBatteryStart ?? null,
    );

    // Data freshness: latest daily summary / HRV calendarDate vs today
    const latestDataDate =
      [latestSummaryRows[0]?.calendarDate, latestHrvRows[0]?.calendarDate]
        .filter((d): d is string => d != null)
        .sort()
        .pop() ?? null;
    const dataFreshness =
      latestDataDate == null ? "none" : latestDataDate >= today ? "fresh" : "stale";

    const base = {
      date: today,
      readiness,
      dataFreshness,
      goalContext: plan ? buildGoalContext(plan, now) : null,
      heartbeat: plan ? await buildHeartbeat(plan.id, now) : null,
      hasAnyHealthData: (summaryCountRows[0]?.count ?? 0) > 0,
      garminConnected: connectionRows.length > 0,
    } as const;

    if (!plan || plan.workouts.length === 0) {
      return NextResponse.json({ state: "no_plan", ...base } satisfies TodayResponse);
    }

    const todaysWorkouts = plan.workouts.filter(
      (w) => w.scheduledDate === today,
    );
    const primary = todaysWorkouts.find((w) => w.workoutType !== "rest") ?? null;

    // Activity matched to today's planned workout (via plannedWorkoutId link
    // or the workout's own completedActivityId pointer)
    const matchedActivity = primary
      ? (todayActivities.find((a) => a.plannedWorkoutId === primary.id) ??
        todayActivities.find(
          (a) => primary.completedActivityId != null && a.id === primary.completedActivityId,
        ) ??
        null)
      : null;

    const workoutDone =
      primary != null &&
      (matchedActivity != null ||
        primary.completionStatus === "completed" ||
        primary.completionStatus === "partial");

    if (workoutDone && primary) {
      const completed = await buildCompletedSummary(
        userId,
        primary,
        matchedActivity,
      );
      return NextResponse.json({
        state: "post_run",
        completed,
        ...base,
      } satisfies TodayResponse);
    }

    // Unplanned run today (no planned workout matched) → post_run as well
    const unplannedRun = todayActivities.find(
      (a) => a.activityType === "run" && a.plannedWorkoutId == null,
    );
    if (!primary && unplannedRun) {
      const feedbackGiven = await hasFeedbackForActivity(userId, unplannedRun.id);
      const completed: CompletedRunSummary = {
        activityId: unplannedRun.id,
        distanceMeters: unplannedRun.distanceMeters
          ? Number(unplannedRun.distanceMeters)
          : null,
        durationSeconds: unplannedRun.durationSeconds,
        avgPaceSecondsPerKm: unplannedRun.avgPaceSecondsPerKm
          ? Number(unplannedRun.avgPaceSecondsPerKm)
          : null,
        workout: null,
        wasPlanned: false,
        rpeGiven: unplannedRun.rpeScore != null,
        feedbackGiven,
      };
      return NextResponse.json({
        state: "post_run",
        completed,
        ...base,
      } satisfies TodayResponse);
    }

    if (primary && primary.completionStatus === "pending") {
      return NextResponse.json({
        state: "pre_run",
        workout: toTodayWorkout(primary),
        ...base,
      } satisfies TodayResponse);
    }

    // Rest day, no workout scheduled today, or today's workout was skipped →
    // recovery framing with a preview of tomorrow's session.
    const tomorrow = buildTomorrowPreview(plan.workouts, today);
    return NextResponse.json({
      state: "rest_day",
      tomorrow,
      ...base,
    } satisfies TodayResponse);
  } catch (error) {
    console.error("Dashboard today error:", error);
    return NextResponse.json(
      { error: "Failed to fetch today overview" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildGoalContext(
  plan: PlanWithWorkouts,
  now: Date,
): TodayGoalContext | null {
  if (!plan.goal?.raceDate) return null;

  // Mirror /api/plan's dynamic week computation (Monday-based weeks across
  // the plan's actual workout date range)
  const firstWorkout = plan.workouts[0];
  const lastWorkout = plan.workouts[plan.workouts.length - 1];
  let currentWeek = plan.currentWeek;
  let totalWeeks = plan.totalWeeks;
  if (firstWorkout && lastWorkout) {
    const planStartMonday = startOfWeek(parseISO(firstWorkout.scheduledDate), {
      weekStartsOn: 1,
    });
    const msSpan =
      parseISO(lastWorkout.scheduledDate).getTime() - planStartMonday.getTime();
    totalWeeks = Math.max(
      plan.totalWeeks,
      Math.floor(msSpan / (7 * 24 * 60 * 60 * 1000)) + 1,
    );
    const todayMonday = startOfWeek(now, { weekStartsOn: 1 });
    currentWeek = Math.max(
      1,
      Math.min(differenceInWeeks(todayMonday, planStartMonday) + 1, totalWeeks),
    );
  }

  return {
    raceName: plan.goal.raceName,
    raceDate: plan.goal.raceDate,
    daysToRace: differenceInCalendarDays(parseISO(plan.goal.raceDate), now),
    currentWeek,
    totalWeeks,
  };
}

async function buildHeartbeat(
  planId: string,
  now: Date,
): Promise<TodayHeartbeat | null> {
  const since = subHours(now, 36);
  const [latest] = await db
    .select({
      createdAt: adaptations.createdAt,
      accepted: adaptations.accepted,
      changes: adaptations.changes,
      explanation: adaptations.explanation,
      triggerType: adaptations.triggerType,
    })
    .from(adaptations)
    .where(and(eq(adaptations.planId, planId), gte(adaptations.createdAt, since)))
    .orderBy(desc(adaptations.createdAt))
    .limit(1);

  if (!latest) return null;

  const changeCount = Array.isArray(latest.changes) ? latest.changes.length : 0;
  const pending = latest.accepted === null;

  let message: string;
  if (pending) {
    message = `Your coach proposed ${changeCount} change${changeCount === 1 ? "" : "s"} to your plan — review them`;
  } else if (latest.accepted) {
    const summary = parseExplanationSummary(latest.explanation);
    message = summary
      ? `Your coach adjusted your plan: ${summary}`
      : `Your coach adjusted your plan (${changeCount} change${changeCount === 1 ? "" : "s"})`;
  } else {
    message = "Your coach proposed changes — you kept your plan as-is";
  }

  return {
    checkedAt: latest.createdAt.toISOString(),
    message,
    pending,
  };
}

/** Adaptation explanations may be structured JSON ({ summary, context }) or legacy plain text */
function parseExplanationSummary(explanation: string): string | null {
  try {
    const parsed = JSON.parse(explanation);
    if (parsed && typeof parsed.summary === "string") return parsed.summary;
  } catch {
    /* legacy plain text */
  }
  return null;
}

interface TodayActivityRow {
  id: string;
  distanceMeters: string | null;
  durationSeconds: number;
  avgPaceSecondsPerKm: string | null;
  wasPlanned: boolean;
  rpeScore: number | null;
}

async function buildCompletedSummary(
  userId: string,
  workout: PlannedWorkoutRow,
  matchedActivity: TodayActivityRow | null,
): Promise<CompletedRunSummary> {
  // Workout marked complete but its linked activity didn't start today
  // (e.g. matched late by the webhook) — fetch it by id so stats still show.
  let activity = matchedActivity;
  if (!activity && workout.completedActivityId) {
    const [row] = await db
      .select({
        id: activities.id,
        distanceMeters: activities.distanceMeters,
        durationSeconds: activities.durationSeconds,
        avgPaceSecondsPerKm: activities.avgPaceSecondsPerKm,
        wasPlanned: activities.wasPlanned,
        rpeScore: activities.rpeScore,
      })
      .from(activities)
      .where(
        and(
          eq(activities.id, workout.completedActivityId),
          eq(activities.userId, userId),
        ),
      )
      .limit(1);
    activity = row ?? null;
  }

  const feedbackGiven = await hasFeedbackForWorkout(userId, workout.id);

  return {
    activityId: activity?.id ?? null,
    distanceMeters: activity?.distanceMeters
      ? Number(activity.distanceMeters)
      : null,
    durationSeconds: activity?.durationSeconds ?? null,
    avgPaceSecondsPerKm: activity?.avgPaceSecondsPerKm
      ? Number(activity.avgPaceSecondsPerKm)
      : null,
    workout: toTodayWorkout(workout),
    wasPlanned: true,
    rpeGiven: workout.rpeScore != null || activity?.rpeScore != null,
    feedbackGiven,
  };
}

async function hasFeedbackForWorkout(
  userId: string,
  workoutId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: workoutFeedback.id })
    .from(workoutFeedback)
    .where(
      and(
        eq(workoutFeedback.userId, userId),
        eq(workoutFeedback.plannedWorkoutId, workoutId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function hasFeedbackForActivity(
  userId: string,
  activityId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: workoutFeedback.id })
    .from(workoutFeedback)
    .where(
      and(
        eq(workoutFeedback.userId, userId),
        eq(workoutFeedback.activityId, activityId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Readiness drivers — qualitative, only what the data supports
// ---------------------------------------------------------------------------

const COMPONENT_LABELS: Record<string, string> = {
  hrv: "HRV",
  sleep: "Sleep",
  bodyBattery: "Body Battery",
  stress: "Stress",
};

function buildReadiness(
  recovery: Awaited<ReturnType<typeof calculateRecoveryReadiness>>,
  totalSleepSeconds: number | null,
  bodyBatteryStart: number | null,
): TodayReadiness {
  const drivers: string[] = [];
  const missing = recovery.missingData.map(
    (key) => COMPONENT_LABELS[key] ?? key,
  );

  if (!recovery.missingData.includes("hrv")) {
    // Component is 0-25; 25 means within the athlete's normal variation band
    if (recovery.components.hrv >= 20) {
      drivers.push("HRV in your normal range");
    } else if (recovery.components.hrv >= 12) {
      drivers.push("HRV slightly below your baseline");
    } else {
      drivers.push("HRV well below your baseline");
    }
  }

  if (!recovery.missingData.includes("sleep")) {
    if (totalSleepSeconds != null && totalSleepSeconds > 0) {
      const h = Math.floor(totalSleepSeconds / 3600);
      const m = Math.round((totalSleepSeconds % 3600) / 60);
      drivers.push(`Sleep ${h}h ${String(m).padStart(2, "0")}m`);
    } else if (recovery.components.sleep >= 18) {
      drivers.push("Good sleep quality");
    } else {
      drivers.push("Sleep quality below your usual");
    }
  }

  if (!recovery.missingData.includes("bodyBattery") && bodyBatteryStart != null) {
    drivers.push(`Body Battery at ${bodyBatteryStart}`);
  }

  if (!recovery.missingData.includes("stress")) {
    if (recovery.components.stress >= 18) {
      drivers.push("Low stress load");
    } else if (recovery.components.stress >= 10) {
      drivers.push("Moderate stress load");
    } else {
      drivers.push("Elevated stress");
    }
  }

  return {
    status: recovery.status,
    confidence: recovery.confidence,
    drivers,
    missing,
  };
}
