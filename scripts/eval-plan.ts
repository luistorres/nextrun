/**
 * Live plan-generation eval runner.
 *
 * Generates a real plan with Claude from a synthetic athlete context —
 * mirroring the exact API call in src/lib/plan-engine/generator.ts — then
 * runs the full eval assertion battery (src/lib/plan-engine/__tests__/eval/
 * assertions.ts) plus runGuardrails, and prints the report.
 *
 * Use this for manual pre-deploy verification of model / prompt / schema
 * changes. It costs real tokens (Opus + thinking), so it is double-guarded
 * and never runs as part of `pnpm test`.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... npx tsx scripts/eval-plan.ts --live
 */

import "dotenv/config";

import {
  sendMessage,
  extractStructuredResult,
  MODELS,
} from "../src/lib/ai/client";
import { RUNNING_COACH_SYSTEM_PROMPT } from "../src/lib/ai/prompts/system";
import {
  buildPlanGenerationPrompt,
  type ActivityContext,
} from "../src/lib/ai/prompts/generate-plan";
import {
  parsePlanOutput,
  getPlanGenerationOutputSchema,
} from "../src/lib/ai/output-parser";
import { calculatePeriodization } from "../src/lib/plan-engine/periodization";
import { pacesFromGoalTime } from "../src/lib/plan-engine/pace-calculator";
import { runGuardrails } from "../src/lib/plan-engine/guardrails";
import type { AthleteAnalysis } from "../src/lib/metrics/athlete-analysis";
import type { PlanGenerationInput } from "../src/types/plan";
import {
  evaluatePlan,
  type PlanEvalContext,
} from "../src/lib/plan-engine/__tests__/eval/assertions";

// ---------------------------------------------------------------------------
// Synthetic athlete: 12-week half marathon, experienced, 4 days/week
// ---------------------------------------------------------------------------

const TOTAL_WEEKS = 12;
const GOAL_DISTANCE_METERS = 21097;
const GOAL_TIME_SECONDS = 6300; // 1:45 half marathon
const CURRENT_WEEKLY_MILEAGE_KM = 40;

const planInput: PlanGenerationInput = {
  goal: {
    type: "race",
    raceName: "Eval Harness Half Marathon",
    targetDistanceMeters: GOAL_DISTANCE_METERS,
    targetTimeSeconds: GOAL_TIME_SECONDS,
    weeksRemaining: TOTAL_WEEKS,
  },
  schedule: {
    daysPerWeek: 4,
    preferredDays: ["tuesday", "thursday", "saturday", "sunday"],
    preferredLongRunDay: "sunday",
  },
  constraints: "Experience: intermediate. No injuries. Trains before work on weekdays.",
};

const evalContext: PlanEvalContext = {
  goalDistanceMeters: GOAL_DISTANCE_METERS,
  totalWeeks: TOTAL_WEEKS,
  daysPerWeek: planInput.schedule.daysPerWeek,
  preferredDays: planInput.schedule.preferredDays,
  preferredLongRunDay: planInput.schedule.preferredLongRunDay,
  experienceLevel: "experienced",
  currentWeeklyMileageKm: CURRENT_WEEKLY_MILEAGE_KM,
};

/**
 * Minimal synthetic AthleteAnalysis — generator.ts builds this from the DB
 * (buildAthleteAnalysis); here we hand-construct a healthy, unremarkable
 * athlete so the eval exercises the prompt, not edge-case health handling.
 */
function buildSyntheticAnalysis(): AthleteAnalysis {
  const today = new Date();
  const fromDate = new Date(today.getTime() - 28 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  return {
    computedAt: today.toISOString(),
    acwr: {
      acuteLoad: 320,
      chronicLoad: 300,
      ratio: 1.07,
      riskBand: "optimal",
      acuteSessions: 5,
      chronicSessions: 19,
    },
    recovery: {
      score: 74,
      status: "ready",
      confidence: "full",
      components: { hrv: 19, sleep: 18, bodyBattery: 19, stress: 18 },
      missingData: [],
    },
    sleepQuality: null,
    paceEfficiency: {
      currentRatio: 1.32,
      baselineRatio: 1.35,
      changePercent: -2.2,
      paceCV: 6.4,
      runCount: 14,
    },
    baseline: {
      hrvAvg: 62,
      sleepScoreAvg: 78,
      restingHRAvg: 52,
      stressAvg: 28,
      bodyBatteryStartAvg: 82,
      vo2MaxAvg: 51,
      fromDate: fmt(fromDate),
      toDate: fmt(today),
      dataPoints: 28,
    },
    trends: [],
    responseProfile: null,
    weeklyLoadSpike: {
      currentWeekLoad: 310,
      previousWeekLoad: 295,
      spikeRatio: 1.05,
      spikePercent: 5.1,
      riskBand: "safe",
      sessionsCurrentWeek: 5,
      sessionsPreviousWeek: 5,
    },
    rpeFatigue: {
      sevenDayAvgRpe: 5.4,
      baselineAvgRpe: 5.6,
      trend: "stable",
      fosterSessionLoad: 1450,
      dataPoints: 5,
    },
    workoutPreferences: null,
    cadenceTrend: {
      current7dAvg: 172,
      baseline28dAvg: 170,
      changePercent: 1.2,
      runCount: 12,
    },
    flags: [],
  };
}

function buildSyntheticActivities(): ActivityContext {
  const recentRuns = [
    { date: "2026-06-07", type: "running", distanceKm: 14.0, durationMin: 80, avgPaceSecsPerKm: 343, avgHR: 148 },
    { date: "2026-06-05", type: "running", distanceKm: 8.0, durationMin: 44, avgPaceSecsPerKm: 330, avgHR: 152 },
    { date: "2026-06-03", type: "running", distanceKm: 10.0, durationMin: 57, avgPaceSecsPerKm: 342, avgHR: 146 },
    { date: "2026-06-01", type: "running", distanceKm: 8.0, durationMin: 46, avgPaceSecsPerKm: 345, avgHR: 144 },
    { date: "2026-05-31", type: "running", distanceKm: 13.0, durationMin: 75, avgPaceSecsPerKm: 346, avgHR: 147 },
  ];
  return {
    recentRuns,
    weeklyMileageKm: CURRENT_WEEKLY_MILEAGE_KM,
    totalActivities: 18,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!process.argv.includes("--live")) {
    console.log(
      [
        "eval-plan: live plan-generation eval (calls the Claude API — costs real tokens).",
        "",
        "This script generates a plan with the production model/prompt/schema and runs",
        "the full eval assertion battery against it. Golden-fixture (offline) evals run",
        "via `pnpm test` — see src/lib/plan-engine/__tests__/eval/eval.test.ts.",
        "",
        "To run for real:  ANTHROPIC_API_KEY=... npx tsx scripts/eval-plan.ts --live",
      ].join("\n"),
    );
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      "eval-plan: ANTHROPIC_API_KEY is not set. Export it (or add it to .env) and re-run with --live.",
    );
    process.exitCode = 1;
    return;
  }

  const periodization = calculatePeriodization(TOTAL_WEEKS, GOAL_DISTANCE_METERS);
  const paces = pacesFromGoalTime(GOAL_DISTANCE_METERS, GOAL_TIME_SECONDS);
  const analysis = buildSyntheticAnalysis();
  const activities = buildSyntheticActivities();

  const prompt = buildPlanGenerationPrompt({
    input: planInput,
    periodization,
    paces,
    analysis,
    activities,
  });

  console.log(`eval-plan: requesting a ${TOTAL_WEEKS}-week plan from ${MODELS.OPUS}...`);

  // Mirrors the production call in src/lib/plan-engine/generator.ts (step 8).
  const outputSchema = getPlanGenerationOutputSchema();
  const response = await sendMessage({
    model: MODELS.OPUS,
    maxTokens: 16000,
    system: RUNNING_COACH_SYSTEM_PROMPT,
    cacheSystemPrompt: true,
    messages: [{ role: "user", content: prompt }],
    outputSchema,
    thinking: true,
  });

  const rawOutput = extractStructuredResult<unknown>(response);
  if (!rawOutput) {
    console.error("eval-plan: Claude did not return structured output");
    process.exitCode = 1;
    return;
  }

  const plan = parsePlanOutput(rawOutput);
  console.log(
    `eval-plan: parsed plan — ${plan.totalWeeks} weeks, ${plan.weeks.reduce((n, w) => n + w.workouts.length, 0)} workouts\n`,
  );

  // ── Assertion battery ─────────────────────────────────────────────
  const report = evaluatePlan(plan, evalContext);
  console.log(report.summary);

  // ── Guardrails (same invocation shape as the generator) ──────────
  const guardrails = runGuardrails(
    plan,
    CURRENT_WEEKLY_MILEAGE_KM,
    evalContext.experienceLevel,
    { acwr: analysis.acwr, recovery: analysis.recovery },
  );
  console.log(
    `\nGuardrails: ${guardrails.warnings.length} warning(s), ${guardrails.adjustments.length} adjustment(s)`,
  );
  for (const warning of guardrails.warnings) console.log(`  ⚠ ${warning}`);
  for (const adjustment of guardrails.adjustments) {
    console.log(`  ✎ [${adjustment.rule}] ${adjustment.description}`);
  }

  if (report.failCount > 0) {
    console.error(`\neval-plan: ${report.failCount} assertion(s) FAILED`);
    process.exitCode = 1;
  } else {
    console.log("\neval-plan: all assertions passed");
  }
}

main().catch((err) => {
  console.error("eval-plan: fatal error:", err);
  process.exitCode = 1;
});
