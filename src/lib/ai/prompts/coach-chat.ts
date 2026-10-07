/**
 * Coach chat prompt and context builder.
 *
 * Provides the system prompt for conversational AI coaching sessions
 * and a function to gather dynamic context (plan, workouts, metrics)
 * for injection into the conversation.
 */

import { db } from "@/lib/db";
import { eq, and, gte, desc, asc } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { format, subDays } from "date-fns";

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export const COACH_CHAT_SYSTEM_PROMPT = `You are the athlete's personal AI running coach. You are supportive, knowledgeable, and data-driven — like a friendly expert who genuinely cares about their progress.

## Your Personality
- Warm and encouraging, never clinical or robotic
- Use the athlete's data to give specific, actionable advice
- Acknowledge the athlete's feelings and context before giving guidance
- Be concise — 2-4 sentences for simple questions, longer for complex topics
- Use plain language to explain training concepts
- When referencing data, be specific ("Your HRV was 45ms last night, which is 12% below your baseline") not vague ("Your metrics look a bit off")

## What You Can Do
- Explain the reasoning behind any workout in the plan
- Discuss the athlete's current training phase and what comes next
- Interpret health metrics (HRV, sleep, stress, recovery) in context
- Suggest how to adjust effort based on how the athlete is feeling
- Explain training concepts (periodization, ACWR, recovery, etc.)
- Provide motivation and perspective when the athlete is struggling

## What You Cannot Do
- You cannot directly modify the training plan. If an athlete asks for plan changes, acknowledge their request, explain what you'd recommend, and let them know the adaptation system will evaluate changes automatically based on their data. They can also trigger a plan review from their Adaptations page.
- You cannot diagnose injuries or medical conditions. If an athlete mentions pain or injury, recommend they consult a medical professional and suggest reducing training load as a precaution.

## Guidelines
- When the athlete says they're tired, feeling great, or provides subjective context, acknowledge it first and then relate it to their objective data if available
- Reference specific upcoming workouts by name when relevant
- Use their plan phase (base, build, peak, taper) to frame advice
- If you don't have enough data to answer confidently, say so honestly
- Format responses with line breaks for readability. Use **bold** for key points and emphasis.
- Do not use headings (##) in responses — they feel too formal for conversation`;

// ---------------------------------------------------------------------------
// Context types
// ---------------------------------------------------------------------------

export interface CoachContext {
  plan: {
    phase: string;
    currentWeek: number;
    totalWeeks: number;
    weeklyMileageTargetKm: string;
    goalType: string;
    raceName: string | null;
    raceDate: string | null;
  } | null;
  upcomingWorkouts: {
    scheduledDate: string;
    workoutType: string;
    title: string;
    description: string | null;
    targetDistanceMeters: number | null;
  }[];
  recentActivities: {
    date: string;
    type: string;
    distanceKm: number;
    durationMin: number;
  }[];
  healthSnapshot: {
    hrv: number | null;
    sleepScore: number | null;
    stress: number | null;
    bodyBattery: number | null;
    restingHR: number | null;
  } | null;
  trainingLoadSummary: string | null;
}

// ---------------------------------------------------------------------------
// Context builder
// ---------------------------------------------------------------------------

/**
 * Gather current plan, upcoming workouts, recent activities, and health data
 * for injection into the coach conversation context.
 */
export async function buildCoachContext(userId: string): Promise<CoachContext> {
  const today = format(new Date(), "yyyy-MM-dd");
  const sevenDaysAgo = subDays(new Date(), 7);

  // Run queries in parallel
  const [activePlan, recentActivities, latestHealth] = await Promise.all([
    db.query.trainingPlans.findFirst({
      where: and(
        eq(schema.trainingPlans.userId, userId),
        eq(schema.trainingPlans.status, "active"),
      ),
      with: {
        goal: true,
        workouts: {
          where: and(
            gte(schema.plannedWorkouts.scheduledDate, today),
          ),
          orderBy: [asc(schema.plannedWorkouts.scheduledDate), asc(schema.plannedWorkouts.sortOrder)],
          limit: 5,
        },
      },
    }),
    db
      .select()
      .from(schema.activities)
      .where(
        and(
          eq(schema.activities.userId, userId),
          gte(schema.activities.startTime, sevenDaysAgo),
        ),
      )
      .orderBy(desc(schema.activities.startTime))
      .limit(10),
    db
      .select()
      .from(schema.dailySummaries)
      .where(eq(schema.dailySummaries.userId, userId))
      .orderBy(desc(schema.dailySummaries.calendarDate))
      .limit(1),
  ]);

  // Fetch latest HRV and sleep separately (different tables)
  const [latestHrv, latestSleep, latestStress] = await Promise.all([
    db
      .select()
      .from(schema.hrvRecords)
      .where(eq(schema.hrvRecords.userId, userId))
      .orderBy(desc(schema.hrvRecords.calendarDate))
      .limit(1),
    db
      .select()
      .from(schema.sleepRecords)
      .where(eq(schema.sleepRecords.userId, userId))
      .orderBy(desc(schema.sleepRecords.calendarDate))
      .limit(1),
    db
      .select()
      .from(schema.stressRecords)
      .where(eq(schema.stressRecords.userId, userId))
      .orderBy(desc(schema.stressRecords.calendarDate))
      .limit(1),
  ]);

  const plan = activePlan
    ? {
        phase: activePlan.phase,
        currentWeek: activePlan.currentWeek,
        totalWeeks: activePlan.totalWeeks,
        weeklyMileageTargetKm: activePlan.weeklyMileageTargetKm,
        goalType: activePlan.goal.goalType,
        raceName: activePlan.goal.raceName,
        raceDate: activePlan.goal.raceDate,
      }
    : null;

  const upcomingWorkouts = (activePlan?.workouts ?? []).map((w) => ({
    scheduledDate: w.scheduledDate,
    workoutType: w.workoutType,
    title: w.title,
    description: w.description,
    targetDistanceMeters: w.targetDistanceMeters,
  }));

  const recentActs = recentActivities.map((a) => ({
    date: format(new Date(a.startTime), "yyyy-MM-dd"),
    type: a.activityType,
    distanceKm: a.distanceMeters
      ? parseFloat(String(a.distanceMeters)) / 1000
      : 0,
    durationMin: a.durationSeconds / 60,
  }));

  const healthSummary = latestHealth[0];
  const healthSnapshot = {
    hrv: latestHrv[0]?.hrvLastNight
      ? Number(latestHrv[0].hrvLastNight)
      : null,
    sleepScore: latestSleep[0]?.sleepScore ?? null,
    stress: latestStress[0]?.avgStress ?? healthSummary?.averageStressLevel ?? null,
    bodyBattery: healthSummary?.bodyBatteryStart ?? null,
    restingHR: healthSummary?.restingHeartRate ?? null,
  };

  // Build a brief training load line
  let trainingLoadSummary: string | null = null;
  if (recentActivities.length > 0) {
    const totalKm = recentActivities.reduce((sum, a) => {
      return sum + (a.distanceMeters ? parseFloat(String(a.distanceMeters)) / 1000 : 0);
    }, 0);
    const totalMin = recentActivities.reduce((sum, a) => sum + a.durationSeconds / 60, 0);
    trainingLoadSummary = `${recentActivities.length} activities in last 7 days: ${totalKm.toFixed(1)}km, ${totalMin.toFixed(0)}min total`;
  }

  return {
    plan,
    upcomingWorkouts,
    recentActivities: recentActs,
    healthSnapshot,
    trainingLoadSummary,
  };
}

// ---------------------------------------------------------------------------
// Format context for prompt injection
// ---------------------------------------------------------------------------

/**
 * Format the coach context into a concise text block for the system prompt.
 */
export function formatCoachContext(ctx: CoachContext): string {
  const lines: string[] = [];

  lines.push("# Current Athlete Context");
  lines.push("");

  if (ctx.plan) {
    lines.push("## Training Plan");
    lines.push(
      `Phase: ${ctx.plan.phase} | Week ${ctx.plan.currentWeek}/${ctx.plan.totalWeeks} | Target: ${ctx.plan.weeklyMileageTargetKm}km/week`,
    );
    lines.push(`Goal: ${ctx.plan.goalType}`);
    if (ctx.plan.raceName) lines.push(`Race: ${ctx.plan.raceName}`);
    if (ctx.plan.raceDate) lines.push(`Race date: ${ctx.plan.raceDate}`);
    lines.push("");
  } else {
    lines.push("## Training Plan");
    lines.push("No active training plan.");
    lines.push("");
  }

  if (ctx.upcomingWorkouts.length > 0) {
    lines.push("## Upcoming Workouts");
    for (const w of ctx.upcomingWorkouts) {
      const dist = w.targetDistanceMeters
        ? `${(w.targetDistanceMeters / 1000).toFixed(1)}km`
        : "";
      lines.push(`- ${w.scheduledDate}: ${w.title} (${w.workoutType}) ${dist}`);
    }
    lines.push("");
  }

  if (ctx.healthSnapshot) {
    const h = ctx.healthSnapshot;
    const parts: string[] = [];
    if (h.hrv !== null) parts.push(`HRV: ${h.hrv}ms`);
    if (h.sleepScore !== null) parts.push(`Sleep: ${h.sleepScore}`);
    if (h.stress !== null) parts.push(`Stress: ${h.stress}`);
    if (h.bodyBattery !== null) parts.push(`Body Battery: ${h.bodyBattery}`);
    if (h.restingHR !== null) parts.push(`RHR: ${h.restingHR}bpm`);
    if (parts.length > 0) {
      lines.push("## Latest Health Metrics");
      lines.push(parts.join(" | "));
      lines.push("");
    }
  }

  if (ctx.recentActivities.length > 0) {
    lines.push("## Recent Activities (7 days)");
    for (const a of ctx.recentActivities.slice(0, 5)) {
      lines.push(
        `- ${a.date}: ${a.type} — ${a.distanceKm.toFixed(1)}km, ${a.durationMin.toFixed(0)}min`,
      );
    }
    lines.push("");
  }

  if (ctx.trainingLoadSummary) {
    lines.push("## Training Load");
    lines.push(ctx.trainingLoadSummary);
    lines.push("");
  }

  return lines.join("\n");
}
