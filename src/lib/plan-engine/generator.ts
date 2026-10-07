/**
 * Plan generation orchestrator.
 *
 * Main entry point for generating a training plan. Coordinates:
 * 1. Loading goal and user data from DB
 * 2. Computing periodization phases and VDOT paces
 * 3. Building an AI prompt with full context
 * 4. Calling Claude to generate the plan
 * 5. Validating output with Zod and guardrails
 * 6. Storing the plan and workouts in the database
 * 7. Workouts stored with syncStatus "pending" — the user pushes them to Garmin from the plan page
 */

import type { Database } from "@/lib/db";
import type { PlanGenerationInput } from "@/types/plan";
import { eq, and, desc, between } from "drizzle-orm";
import * as schema from "@/lib/db/schema";

import { sendMessage, extractStructuredResult, MODELS } from "@/lib/ai/client";
import { RUNNING_COACH_SYSTEM_PROMPT, PROMPT_VERSION } from "@/lib/ai/prompts/system";
import {
  buildPlanGenerationPrompt,
  type ActivityContext,
} from "@/lib/ai/prompts/generate-plan";
import { buildAthleteAnalysis } from "@/lib/metrics/athlete-analysis";
import { parsePlanOutput, getPlanGenerationOutputSchema } from "@/lib/ai/output-parser";
import {
  calculatePeriodization,
  weeksUntilRace,
} from "@/lib/plan-engine/periodization";
import {
  getTrainingPaces,
  estimateVDOT,
  estimateVDOTFromRecentRuns,
  blendGoalAndCurrentVdot,
  pacesFromGoalTime,
  GOAL_VDOT_BLEND_THRESHOLD,
  type TrainingPaces,
} from "@/lib/plan-engine/pace-calculator";
import { runGuardrails, significantViolations } from "@/lib/plan-engine/guardrails";

import { addDays, startOfWeek, format } from "date-fns";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GeneratePlanResult {
  planId: string;
  totalWeeks: number;
  workoutCount: number;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Main generator function
// ---------------------------------------------------------------------------

/**
 * Generate a complete training plan for a user goal.
 *
 * @param db - Database instance (from @/lib/db or workers/shared/db)
 * @param userId - The authenticated user's ID
 * @param goalId - The user_goals ID to generate a plan for
 * @returns Plan metadata and any guardrail warnings
 */
export async function generatePlan(
  db: Database,
  userId: string,
  goalId: string,
): Promise<GeneratePlanResult> {
  // ── 1. Load goal ──────────────────────────────────────────────────
  const [goal] = await db
    .select()
    .from(schema.userGoals)
    .where(
      and(eq(schema.userGoals.id, goalId), eq(schema.userGoals.userId, userId)),
    )
    .limit(1);

  if (!goal) {
    throw new Error(`Goal ${goalId} not found for user ${userId}`);
  }

  if (goal.status !== "active") {
    throw new Error(`Goal ${goalId} is not active (status: ${goal.status})`);
  }

  // ── 2. Calculate weeks remaining ──────────────────────────────────
  const today = new Date();
  let weeksRemaining: number;

  if (goal.raceDate) {
    weeksRemaining = Math.max(4, weeksUntilRace(goal.raceDate, today));
  } else {
    // Default 12-week plan for non-race goals
    weeksRemaining = 12;
  }

  // ── 3. Load athlete analysis + recent activities in parallel ──────
  const thirtyDaysAgoDate = addDays(today, -30);

  const [analysis, recentActivities] = await Promise.all([
    buildAthleteAnalysis(db, userId, today),
    db
      .select()
      .from(schema.activities)
      .where(
        and(
          eq(schema.activities.userId, userId),
          between(schema.activities.startTime, thirtyDaysAgoDate, today),
        ),
      )
      .orderBy(desc(schema.activities.startTime)),
  ]);

  // ── 4. Build activity context ─────────────────────────────────────
  let activityContext: ActivityContext | undefined;

  const runActivities = recentActivities.filter(
    (a) => a.activityType === "run" || a.activityType === "running",
  );

  if (runActivities.length > 0) {
    const totalDistKm = runActivities.reduce(
      (sum, a) => sum + (a.distanceMeters ? parseFloat(String(a.distanceMeters)) / 1000 : 0),
      0,
    );
    const weekSpan = Math.max(1, 30 / 7); // ~4.3 weeks

    activityContext = {
      recentRuns: runActivities.slice(0, 10).map((a) => ({
        date: format(new Date(a.startTime), "yyyy-MM-dd"),
        type: a.activityType,
        distanceKm: a.distanceMeters ? parseFloat(String(a.distanceMeters)) / 1000 : 0,
        durationMin: a.durationSeconds / 60,
        avgPaceSecsPerKm: a.avgPaceSecondsPerKm
          ? parseFloat(String(a.avgPaceSecondsPerKm))
          : 0,
        avgHR: a.avgHeartRate ?? undefined,
      })),
      weeklyMileageKm: totalDistKm / weekSpan,
      totalActivities: recentActivities.length,
    };
  }

  // ── 5. Calculate periodization ────────────────────────────────────
  const periodization = calculatePeriodization(
    weeksRemaining,
    goal.targetDistanceMeters ?? undefined,
  );

  // ── 6. Determine experience level ──────────────────────────────────
  // Onboarding stores the declared level inside the constraints text
  // ("Experience: beginner. ..."); prefer it over the days-per-week
  // heuristic, which misclassifies time-poor experienced runners.
  const declaredExperience = goal.constraints
    ?.match(/experience:\s*(beginner|intermediate|advanced)/i)?.[1]
    ?.toLowerCase();
  const experienceLevel: "beginner" | "experienced" =
    declaredExperience === "beginner" ||
    (declaredExperience == null && goal.trainingDaysPerWeek <= 3)
      ? "beginner"
      : "experienced";

  // ── 6b. Calculate training paces ───────────────────────────────────
  // Beginners without data get a conservative VDOT fallback: aggressive
  // default paces for new runners are an injury vector (the most common
  // complaint about competitor default plans).
  const fallbackVdot = experienceLevel === "beginner" ? 40 : 45;
  let paces: TrainingPaces;

  // Current fitness from recent runs, anchored to genuinely easy efforts only
  // (HR-gated when available) — averaging workouts/intervals inflates VDOT.
  const currentVdot =
    activityContext && activityContext.recentRuns.length > 0
      ? estimateVDOTFromRecentRuns(activityContext.recentRuns)
      : null;

  if (goal.targetTimeSeconds && goal.targetDistanceMeters) {
    // Use goal race time to estimate paces, blended conservatively against
    // observed fitness: a goal far ahead of recent runs is aspirational, and
    // anchoring every workout to it prescribes paces the runner can't hold.
    const goalVdot = estimateVDOT({
      distanceMeters: goal.targetDistanceMeters,
      timeSeconds: goal.targetTimeSeconds,
    });
    const blend = blendGoalAndCurrentVdot(goalVdot, currentVdot);
    if (blend.blended) {
      console.warn(
        `[plan-generator] Goal-derived VDOT ${goalVdot} is more than ` +
          `${GOAL_VDOT_BLEND_THRESHOLD} points above current fitness ` +
          `(VDOT ${currentVdot}); using midpoint ${blend.vdot} for training paces`,
      );
      paces = getTrainingPaces(blend.vdot);
    } else {
      paces = pacesFromGoalTime(
        goal.targetDistanceMeters,
        goal.targetTimeSeconds,
      );
    }
  } else if (currentVdot != null) {
    // Estimate from recent easy runs
    paces = getTrainingPaces(currentVdot);
  } else {
    paces = getTrainingPaces(fallbackVdot);
  }

  // ── 7. Build AI prompt ────────────────────────────────────────────
  const planInput: PlanGenerationInput = {
    goal: {
      type: goal.goalType as PlanGenerationInput["goal"]["type"],
      raceName: goal.raceName ?? undefined,
      raceDate: goal.raceDate ?? undefined,
      targetDistanceMeters: goal.targetDistanceMeters,
      targetTimeSeconds: goal.targetTimeSeconds ?? undefined,
      weeksRemaining,
    },
    schedule: {
      daysPerWeek: goal.trainingDaysPerWeek,
      preferredDays: goal.preferredTrainingDays,
      preferredLongRunDay: goal.preferredLongRunDay,
    },
    constraints: goal.constraints ?? undefined,
  };

  const prompt = buildPlanGenerationPrompt({
    input: planInput,
    periodization,
    paces,
    analysis,
    activities: activityContext,
    healthConstraints: goal.healthConstraints ?? undefined,
  });

  // ── 8. Call Claude API ───────────────────────────────────────────
  // Structured outputs guarantee schema-valid JSON, and (unlike forced
  // tool_choice) are compatible with adaptive thinking — which materially
  // helps multi-week plan coherence.
  const outputSchema = getPlanGenerationOutputSchema();

  const response = await sendMessage({
    model: MODELS.OPUS,
    maxTokens: 16000,
    system: RUNNING_COACH_SYSTEM_PROMPT,
    cacheSystemPrompt: true,
    messages: [{ role: "user", content: prompt }],
    outputSchema,
    thinking: true,
    trace: { callsite: "plan-generation", userId },
  });

  // ── 9. Parse and validate output ─────────────────────────────────
  const rawOutput = extractStructuredResult<unknown>(response);
  if (!rawOutput) {
    throw new Error("Claude did not return structured output");
  }

  const parsedPlan = parsePlanOutput(rawOutput);

  // ── 10. Run guardrails ───────────────────────────────────────────
  const currentMileage = activityContext?.weeklyMileageKm;

  const guardrailResult = runGuardrails(
    parsedPlan,
    currentMileage,
    experienceLevel,
    { acwr: analysis.acwr, recovery: analysis.recovery },
    goal.healthConstraints ?? undefined,
  );

  let finalPlan = guardrailResult.plan;
  let finalWarnings = guardrailResult.warnings;

  // ── 10b. Adversarial regeneration — re-prompt Claude with violated constraints ──
  // Instead of accepting mechanical patches, ask Claude to produce a globally coherent
  // plan that naturally satisfies the violated constraints (closed-loop from LLM-SPTRec).
  const firstSignificant = significantViolations(guardrailResult.violations);

  if (!guardrailResult.valid && firstSignificant.length > 0) {
    const directiveList = firstSignificant
      .map((v) => `• ${v.directive}`)
      .join("\n");

    const retryPrompt =
      `${prompt}\n\nCRITICAL — Your previous plan violated the following constraints. ` +
      `Regenerate a coherent plan that naturally satisfies ALL of these from the start ` +
      `(do not simply clip values — design the plan to respect them throughout):\n${directiveList}`;

    try {
      const retryResponse = await sendMessage({
        model: MODELS.OPUS,
        maxTokens: 16000,
        system: RUNNING_COACH_SYSTEM_PROMPT,
        cacheSystemPrompt: true,
        messages: [{ role: "user", content: retryPrompt }],
        outputSchema,
        thinking: true,
        trace: { callsite: "plan-generation-retry", userId },
      });

      const retryRaw = extractStructuredResult<unknown>(retryResponse);
      if (retryRaw) {
        const retryParsed = parsePlanOutput(retryRaw);
        const retryGuardrails = runGuardrails(
          retryParsed,
          currentMileage,
          experienceLevel,
          { acwr: analysis.acwr, recovery: analysis.recovery },
          goal.healthConstraints ?? undefined,
        );
        const retrySignificant = significantViolations(retryGuardrails.violations);
        if (retrySignificant.length === 0) {
          finalPlan = retryGuardrails.plan;
          finalWarnings = retryGuardrails.warnings;
          console.log(
            `[generator] Adversarial regeneration succeeded — ${retryGuardrails.warnings.length} warnings remaining`,
          );
        } else {
          // Fail closed: the mechanically-patched first attempt already
          // satisfies the ACWR caps; a retry that still violates them does not.
          finalWarnings = [
            ...guardrailResult.warnings,
            ...retrySignificant.map((v) => v.directive),
          ];
          console.warn(
            `[generator] Regenerated plan still violates ${retrySignificant.map((v) => v.rule).join(", ")} — keeping patched first attempt`,
          );
        }
      } else {
        console.warn(
          "[generator] Adversarial regeneration returned no structured output — keeping patched first attempt",
        );
      }
    } catch (err) {
      console.warn(
        "[generator] Adversarial regeneration failed, using patched plan:",
        err,
      );
    }
  }

  // ── 11. Supersede any existing active plan ───────────────────────
  const existingPlans = await db
    .select({ id: schema.trainingPlans.id })
    .from(schema.trainingPlans)
    .where(
      and(
        eq(schema.trainingPlans.userId, userId),
        eq(schema.trainingPlans.goalId, goalId),
        eq(schema.trainingPlans.status, "active"),
      ),
    );

  // Collect Garmin workout IDs from old plans so we can delete them
  const oldGarminWorkoutIds: string[] = [];
  for (const ep of existingPlans) {
    const oldWorkouts = await db
      .select({ garminWorkoutId: schema.plannedWorkouts.garminWorkoutId })
      .from(schema.plannedWorkouts)
      .where(eq(schema.plannedWorkouts.planId, ep.id));

    for (const w of oldWorkouts) {
      if (w.garminWorkoutId) oldGarminWorkoutIds.push(w.garminWorkoutId);
    }

    await db
      .update(schema.trainingPlans)
      .set({ status: "superseded" })
      .where(eq(schema.trainingPlans.id, ep.id));
  }

  // Queue Garmin deletes for superseded plan workouts
  if (oldGarminWorkoutIds.length > 0) {
    const { enqueueGarminSync } = await import("@/lib/queue/producer");
    await enqueueGarminSync({
      userId,
      workoutIds: [],
      action: "delete",
      garminWorkoutIds: oldGarminWorkoutIds,
    });
  }

  // ── 12. Store plan in database ───────────────────────────────────
  const firstPhase = finalPlan.phases[0]?.phase ?? "base";

  const [plan] = await db
    .insert(schema.trainingPlans)
    .values({
      userId,
      goalId,
      planVersion: 1,
      phase: firstPhase,
      currentWeek: 1,
      totalWeeks: finalPlan.totalWeeks,
      weeklyMileageTargetKm: String(finalPlan.weeks[0]?.weeklyMileageTargetKm ?? 0),
      generatedBy: "ai_initial",
      generationContext: {
        input: planInput,
        paces,
        periodization,
        analysis: {
          acwr: analysis.acwr,
          recovery: analysis.recovery,
          sleepQuality: analysis.sleepQuality,
          flags: analysis.flags,
        },
        activityContext: activityContext
          ? {
              weeklyMileageKm: activityContext.weeklyMileageKm,
              totalActivities: activityContext.totalActivities,
            }
          : null,
        guardrailWarnings: finalWarnings,
        promptVersion: PROMPT_VERSION,
      },
      status: "active",
    })
    .returning();

  // ── 13. Store workouts ───────────────────────────────────────────
  const planStartDate = startOfWeek(today, { weekStartsOn: 1 }); // Monday
  let sortOrder = 0;
  const workoutInserts: (typeof schema.plannedWorkouts.$inferInsert)[] = [];

  for (const week of finalPlan.weeks) {
    const weekStartDate = addDays(planStartDate, (week.weekNumber - 1) * 7);

    for (const workout of week.workouts) {
      const dayOffset = dayToOffset(workout.day);
      const scheduledDate = addDays(weekStartDate, dayOffset);

      workoutInserts.push({
        planId: plan.id,
        scheduledDate: format(scheduledDate, "yyyy-MM-dd"),
        dayOfWeek: workout.day.toLowerCase(),
        workoutType: workout.type,
        title: workout.title,
        description: workout.description,
        targetDistanceMeters: workout.targetDistanceMeters ?? null,
        targetDurationSeconds: workout.targetDurationSeconds ?? null,
        workoutSteps: workout.steps.length > 0 ? workout.steps : null,
        syncStatus: "pending",
        completionStatus: "pending",
        sortOrder: sortOrder++,
      });
    }
  }

  let workoutCount = 0;
  if (workoutInserts.length > 0) {
    const inserted = await db
      .insert(schema.plannedWorkouts)
      .values(workoutInserts)
      .returning({ id: schema.plannedWorkouts.id });
    workoutCount = inserted.length;
  }

  return {
    planId: plan.id,
    totalWeeks: finalPlan.totalWeeks,
    workoutCount,
    warnings: finalWarnings,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dayToOffset(day: string): number {
  const map: Record<string, number> = {
    monday: 0,
    tuesday: 1,
    wednesday: 2,
    thursday: 3,
    friday: 4,
    saturday: 5,
    sunday: 6,
  };
  return map[day.toLowerCase()] ?? 0;
}

