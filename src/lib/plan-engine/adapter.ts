/**
 * Adaptation orchestrator.
 *
 * Main entry point for evaluating and generating plan adaptations.
 * Coordinates metrics calculation, decision matrix evaluation,
 * AI prompt building, and adaptation record creation.
 */

import type { Database } from "@/lib/db";
import type { AdaptationTrigger, AdaptationChange, AdaptationOutput, PlanPhase } from "@/types/plan";
import { eq, and, desc, gte, lte, isNull, isNotNull, count, sum } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { format, subDays, addDays } from "date-fns";
import { formatFeedbackForPrompt } from "@/lib/plan-engine/feedback-context";

import { calculateTrainingLoad } from "@/lib/metrics/training-load";
import { buildAthleteAnalysis } from "@/lib/metrics/athlete-analysis";
import { calculateWorkoutExecutionSummary } from "@/lib/metrics/workout-execution";
import { evaluateDecisionMatrix } from "@/lib/plan-engine/decision-matrix";
import {
  buildAdaptationPrompt,
  getAdaptationOutputSchema,
  type AdaptationPromptContext,
} from "@/lib/ai/prompts/adapt-plan";
import { sendMessage, extractStructuredResult } from "@/lib/ai/client";
import { parseAdaptationOutput } from "@/lib/ai/output-parser";
import { checkAdaptationGuardrails } from "@/lib/plan-engine/adaptation-guardrails";
import { findUpdatedWorkout } from "@/lib/plan-engine/adaptation-applier";
import { RUNNING_COACH_SYSTEM_PROMPT } from "@/lib/ai/prompts/system";
import { triageAdaptation } from "@/lib/ai/triage";


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdaptPlanResult {
  adapted: boolean;
  adaptationId?: string;
  explanation: string;
  changes: AdaptationChange[];
  severity: "low" | "medium" | "high";
}

export interface AdaptPlanOptions {
  trigger: AdaptationTrigger;
  hasUnplannedActivity?: boolean;
  userContext?: string;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Evaluate an active plan and generate an adaptation if needed.
 *
 * @param db - Database instance (app or worker)
 * @param userId - The user owning the plan
 * @param planId - The active training plan ID
 * @param options - Options including trigger type, unplanned activity flag, and optional user context
 */
export async function adaptPlan(
  db: Database,
  userId: string,
  planId: string,
  options: AdaptPlanOptions,
): Promise<AdaptPlanResult> {
  const { trigger, hasUnplannedActivity = false, userContext } = options;
  // ── 1. Load current plan with goal ─────────────────────────────────────
  const plan = await db.query.trainingPlans.findFirst({
    where: and(
      eq(schema.trainingPlans.id, planId),
      eq(schema.trainingPlans.userId, userId),
      eq(schema.trainingPlans.status, "active"),
    ),
    with: {
      goal: true,
    },
  });

  if (!plan) {
    return {
      adapted: false,
      explanation: "No active plan found",
      changes: [],
      severity: "low",
    };
  }

  // ── 2. Load future workouts (only modify upcoming ones) ────────────────
  const today = format(new Date(), "yyyy-MM-dd");
  const twoWeeksLater = format(addDays(new Date(), 14), "yyyy-MM-dd");

  const upcomingWorkouts = await db
    .select()
    .from(schema.plannedWorkouts)
    .where(
      and(
        eq(schema.plannedWorkouts.planId, planId),
        gte(schema.plannedWorkouts.scheduledDate, today),
        lte(schema.plannedWorkouts.scheduledDate, twoWeeksLater),
        eq(schema.plannedWorkouts.completionStatus, "pending"),
      ),
    )
    .orderBy(schema.plannedWorkouts.scheduledDate, schema.plannedWorkouts.sortOrder);

  if (upcomingWorkouts.length === 0) {
    return {
      adapted: false,
      explanation: "No upcoming workouts to adapt",
      changes: [],
      severity: "low",
    };
  }

  // ── 3. Calculate metrics (derived + training load + execution quality) ──
  const now = new Date();
  const [analysis, trainingLoad, workoutExecution] = await Promise.all([
    buildAthleteAnalysis(db, userId, now, planId),
    calculateTrainingLoad(db, userId, planId, now),
    calculateWorkoutExecutionSummary(db, userId, planId, now),
  ]);

  // ── 4. Run decision matrix (using derived metrics) ──────────────────
  let decision = evaluateDecisionMatrix({
    acwr: analysis.acwr,
    recovery: analysis.recovery,
    sleepQuality: analysis.sleepQuality,
    trends: analysis.trends,
    trainingLoad,
    hasUnplannedActivity,
    workoutExecution,
    weeklyLoadSpike: analysis.weeklyLoadSpike,
    rpeFatigue: analysis.rpeFatigue,
  });

  // For user-requested adaptations: evaluate metrics for context, but bypass the gate
  const isUserRequest = trigger === "user_request";

  if (!decision.shouldAdapt && !isUserRequest) {
    return {
      adapted: false,
      explanation: "Metrics are within acceptable ranges; no adaptation needed.",
      changes: [],
      severity: decision.severity,
    };
  }

  // Ensure user requests always have at least one trigger for prompt context
  if (isUserRequest && decision.triggers.length === 0) {
    decision = {
      ...decision,
      shouldAdapt: true,
      triggers: [{
        type: "user_request",
        reason: userContext ? `Athlete requested: "${userContext}"` : "Athlete manually requested plan review",
        severity: "medium",
        metric: undefined,
        value: undefined,
        threshold: undefined,
      }],
    };
  }

  // ── 4b. Haiku triage — skip expensive Sonnet call if not needed ────────
  if (!isUserRequest) {
    const triage = await triageAdaptation({
      userId,
      acwr: analysis.acwr,
      recovery: analysis.recovery,
      decision,
      trainingLoad,
      phase: plan.phase,
      currentWeek: plan.currentWeek,
      totalWeeks: plan.totalWeeks,
    });

    if (!triage.shouldAdapt) {
      console.log(
        `[adapt] Triage skipped adaptation — ${triage.reason} (saved ~$0.06)`,
      );
      return {
        adapted: false,
        explanation: `Triage: ${triage.reason}`,
        changes: [],
        severity: decision.severity,
      };
    }
  }

  // ── 5. Load recent activities + feedback + shoes for prompt context ─
  const sevenDaysAgo = subDays(now, 7);
  const thirtyDaysAgo = subDays(now, 30);
  const [recentActivities, recentFeedback, userShoes, shoeTotals, recentRunsByShoe] = await Promise.all([
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
      .limit(15),
    db
      .select()
      .from(schema.workoutFeedback)
      .where(
        and(
          eq(schema.workoutFeedback.userId, userId),
          gte(schema.workoutFeedback.createdAt, sevenDaysAgo),
        ),
      )
      .orderBy(desc(schema.workoutFeedback.createdAt))
      .limit(20),
    // Active shoes (mileage is computed, never stored)
    db
      .select()
      .from(schema.shoes)
      .where(
        and(eq(schema.shoes.userId, userId), isNull(schema.shoes.retiredAt)),
      ),
    // All-time assigned distance per shoe
    db
      .select({
        shoeId: schema.activities.shoeId,
        totalMeters: sum(schema.activities.distanceMeters),
      })
      .from(schema.activities)
      .where(
        and(
          eq(schema.activities.userId, userId),
          isNotNull(schema.activities.shoeId),
        ),
      )
      .groupBy(schema.activities.shoeId),
    // Last-30d run counts per shoe (null shoeId group = unassigned runs)
    db
      .select({
        shoeId: schema.activities.shoeId,
        runs: count(schema.activities.id),
      })
      .from(schema.activities)
      .where(
        and(
          eq(schema.activities.userId, userId),
          eq(schema.activities.activityType, "run"),
          gte(schema.activities.startTime, thirtyDaysAgo),
        ),
      )
      .groupBy(schema.activities.shoeId),
  ]);

  // ── 5b. Build compact shoe context (manual assignment — Garmin has no gear API)
  let shoesContext: AdaptationPromptContext["shoes"];
  let shoeCoverage: AdaptationPromptContext["shoeCoverage"];
  if (userShoes.length > 0) {
    const totalMetersByShoe = new Map(
      shoeTotals.map((t) => [t.shoeId, Number(t.totalMeters ?? 0)]),
    );
    const recentRunCountByShoe = new Map(
      recentRunsByShoe.map((r) => [r.shoeId, r.runs]),
    );
    const totalRecentRuns = recentRunsByShoe.reduce((s, r) => s + r.runs, 0);
    const assignedRecentRuns = recentRunsByShoe
      .filter((r) => r.shoeId !== null)
      .reduce((s, r) => s + r.runs, 0);

    shoesContext = userShoes.map((s) => ({
      name: s.name,
      category: s.category,
      totalKm:
        Number(s.startingKm) + (totalMetersByShoe.get(s.id) ?? 0) / 1000,
      recentRunSharePct:
        totalRecentRuns > 0
          ? Math.round(
              ((recentRunCountByShoe.get(s.id) ?? 0) / totalRecentRuns) * 100,
            )
          : null,
    }));
    shoeCoverage = {
      totalRuns: totalRecentRuns,
      assignedRuns: assignedRecentRuns,
    };
  }

  // ── 6. Build AI prompt ─────────────────────────────────────────────────
  const promptContext: AdaptationPromptContext = {
    plan: {
      id: plan.id,
      phase: plan.phase,
      currentWeek: plan.currentWeek,
      totalWeeks: plan.totalWeeks,
      weeklyMileageTargetKm: plan.weeklyMileageTargetKm,
      planVersion: plan.planVersion,
    },
    goal: {
      goalType: plan.goal.goalType,
      raceName: plan.goal.raceName,
      raceDate: plan.goal.raceDate,
      targetDistanceMeters: plan.goal.targetDistanceMeters,
      targetTimeSeconds: plan.goal.targetTimeSeconds,
    },
    healthConstraints: plan.goal.healthConstraints ?? undefined,
    upcomingWorkouts: upcomingWorkouts.map((w) => ({
      id: w.id,
      scheduledDate: w.scheduledDate,
      workoutType: w.workoutType,
      title: w.title,
      description: w.description,
      targetDistanceMeters: w.targetDistanceMeters,
      targetDurationSeconds: w.targetDurationSeconds,
    })),
    recentActivities: recentActivities.map((a) => ({
      date: format(new Date(a.startTime), "yyyy-MM-dd"),
      type: a.activityType,
      distanceKm: a.distanceMeters
        ? parseFloat(String(a.distanceMeters)) / 1000
        : 0,
      durationMin: a.durationSeconds / 60,
      wasPlanned: a.wasPlanned,
      plannedWorkoutId: a.plannedWorkoutId ?? undefined,
    })),
    shoes: shoesContext,
    shoeCoverage,
    analysis,
    trainingLoad,
    workoutExecution,
    decision,
    triggerType: trigger,
    feedbackContext: formatFeedbackForPrompt(recentFeedback),
    userContext,
  };

  const prompt = buildAdaptationPrompt(promptContext);

  // ── 7. Call Claude API ─────────────────────────────────────────────────
  // Structured outputs guarantee schema-valid JSON and allow adaptive
  // thinking (forced tool_choice did not).
  const response = await sendMessage({
    maxTokens: 8000,
    system: RUNNING_COACH_SYSTEM_PROMPT,
    cacheSystemPrompt: true,
    messages: [{ role: "user", content: prompt }],
    outputSchema: getAdaptationOutputSchema(),
    thinking: true,
    trace: { callsite: "adaptation", userId },
  });

  // ── 8. Parse AI output ─────────────────────────────────────────────────
  const rawOutput = extractStructuredResult<unknown>(response);
  const aiOutput = rawOutput ? parseAdaptationOutput(rawOutput) : null;

  if (!aiOutput) {
    return {
      adapted: false,
      explanation: "AI did not return a valid adaptation response",
      changes: [],
      severity: decision.severity,
    };
  }

  // ── 9. If AI says no adaptation needed ─────────────────────────────────
  if (!aiOutput.needed) {
    return {
      adapted: false,
      explanation: aiOutput.explanation.summary,
      changes: [],
      severity: decision.severity,
    };
  }

  // ── 9b. Guardrail gate on the proposal ─────────────────────────────────
  const gateEnabled = process.env.ADAPTATION_GUARDRAIL_GATE !== "off";
  const guardrailCheck = checkAdaptationGuardrails({
    workouts: upcomingWorkouts,
    output: aiOutput,
    planPhase: plan.phase as PlanPhase,
    athleteContext: { acwr: analysis.acwr, recovery: analysis.recovery },
    healthConstraints: plan.goal.healthConstraints ?? undefined,
  });

  // Referential errors reject unconditionally; the kill switch bypasses only
  // the guardrail-delta heuristics.
  const reject =
    guardrailCheck.referentialErrors.length > 0 ||
    (gateEnabled && guardrailCheck.newViolations.length > 0);

  if (reject) {
    const reasons = [
      ...guardrailCheck.referentialErrors,
      ...guardrailCheck.newViolations.map((v) => v.rule),
    ].join(", ");
    console.warn(
      `[adapter] adaptation proposal rejected by guardrails (${reasons}) for plan ${planId}`,
    );
    const details = [
      ...guardrailCheck.referentialErrors,
      ...guardrailCheck.newViolations.map((v) => `${v.rule}: ${v.directive}`),
    ].join("\n");
    const { notifyOwner } = await import("@/lib/utils/telegram");
    await notifyOwner(
      `Adaptation proposal rejected for plan ${planId}:\n${details}`,
    ).catch(() => {});
    return {
      adapted: false,
      explanation: `Adaptation proposal rejected by safety guardrails: ${reasons}`,
      changes: [],
      severity: decision.severity,
    };
  }

  // Persist the gate-resolved dates so the applier replays the exact dates
  // the gate validated (an undated add resolved "today" here must not drift
  // to a different day at accept time).
  for (const [idx, day] of Object.entries(guardrailCheck.resolvedAddedDates)) {
    const change = aiOutput.changes[Number(idx)];
    const sub = findUpdatedWorkout(change, aiOutput.updatedWorkouts);
    if (sub) sub.day = day;
  }

  // ── 10. Store adaptation record (pending acceptance) ───────────────────
  return await storeAdaptation(db, plan, trigger, aiOutput, analysis, trainingLoad, decision, guardrailCheck.warnings, userContext);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function storeAdaptation(
  db: Database,
  plan: { id: string; planVersion: number },
  trigger: AdaptationTrigger,
  aiOutput: AdaptationOutput,
  analysis: Awaited<ReturnType<typeof buildAthleteAnalysis>>,
  trainingLoad: Awaited<ReturnType<typeof calculateTrainingLoad>>,
  decision: ReturnType<typeof evaluateDecisionMatrix>,
  guardrailWarnings: string[],
  userContext?: string,
): Promise<AdaptPlanResult> {
  const newVersion = plan.planVersion + 1;

  const adaptation = await db.transaction(async (tx) => {
    await tx
      .update(schema.adaptations)
      .set({ supersededAt: new Date() })
      .where(
        and(
          eq(schema.adaptations.planId, plan.id),
          isNull(schema.adaptations.accepted),
          isNull(schema.adaptations.supersededAt),
        ),
      );

    const [inserted] = await tx
      .insert(schema.adaptations)
      .values({
        planId: plan.id,
        oldPlanVersion: plan.planVersion,
        newPlanVersion: newVersion,
        triggerType: trigger,
        changes: aiOutput.changes,
        updatedWorkouts: aiOutput.updatedWorkouts ?? null,
        explanation: JSON.stringify(aiOutput.explanation),
        metricsSnapshot: {
          baseline: analysis.baseline,
          trends: analysis.trends,
          acwr: analysis.acwr,
          recovery: analysis.recovery,
          trainingLoad,
          triggers: decision.triggers,
          severity: decision.severity,
          guardrailWarnings,
        },
        accepted: null,
        userContext: userContext ?? null,
      })
      .returning();
    return inserted;
  });

  return {
    adapted: true,
    adaptationId: adaptation.id,
    explanation: aiOutput.explanation.summary,
    changes: aiOutput.changes,
    severity: decision.severity,
  };
}
