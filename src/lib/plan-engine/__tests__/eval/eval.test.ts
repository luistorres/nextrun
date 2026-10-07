/**
 * Plan-generation eval harness — golden fixture tests.
 *
 * Three hand-constructed fixtures pin down what a "good" plan looks like:
 *  - marathon-12wk-experienced.json: correct — every assertion must pass
 *  - 10k-8wk-beginner.json: correct — every assertion must pass
 *  - half-16wk-intermediate-flawed.json: deliberately flawed (sawtooth
 *    progression + gutted taper intensity) — the harness must catch exactly
 *    those flaws, proving it has teeth.
 *
 * Live model output can be run through the same assertions via
 * `npx tsx scripts/eval-plan.ts --live`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parsePlanOutput } from "@/lib/ai/output-parser";
import { runGuardrails } from "@/lib/plan-engine/guardrails";
import type { PlanGenerationOutput } from "@/types/plan";

import {
  evaluatePlan,
  failedRules,
  type PlanEvalContext,
} from "./assertions";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadFixture(name: string): PlanGenerationOutput {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  // parsePlanOutput applies the Zod schema, so a malformed fixture fails loudly.
  return parsePlanOutput(readFileSync(path, "utf8"));
}

function clone(plan: PlanGenerationOutput): PlanGenerationOutput {
  return JSON.parse(JSON.stringify(plan)) as PlanGenerationOutput;
}

const marathonContext: PlanEvalContext = {
  goalDistanceMeters: 42195,
  totalWeeks: 12,
  daysPerWeek: 5,
  preferredDays: ["monday", "tuesday", "thursday", "saturday", "sunday"],
  preferredLongRunDay: "sunday",
  experienceLevel: "experienced",
  currentWeeklyMileageKm: 50,
};

const tenKContext: PlanEvalContext = {
  goalDistanceMeters: 10000,
  totalWeeks: 8,
  daysPerWeek: 3,
  preferredDays: ["tuesday", "thursday", "saturday"],
  preferredLongRunDay: "saturday",
  experienceLevel: "beginner",
  currentWeeklyMileageKm: 20,
};

const halfContext: PlanEvalContext = {
  goalDistanceMeters: 21097,
  totalWeeks: 16,
  daysPerWeek: 4,
  preferredDays: ["monday", "wednesday", "friday", "sunday"],
  preferredLongRunDay: "sunday",
  experienceLevel: "experienced",
  currentWeeklyMileageKm: 38,
};

const marathonPlan = loadFixture("marathon-12wk-experienced.json");
const tenKPlan = loadFixture("10k-8wk-beginner.json");
const flawedHalfPlan = loadFixture("half-16wk-intermediate-flawed.json");

// ---------------------------------------------------------------------------
// Golden fixtures: correct plans must pass every assertion
// ---------------------------------------------------------------------------

describe("eval harness — golden fixtures", () => {
  it("12-week marathon plan (experienced, 5 days) passes every assertion", () => {
    const report = evaluatePlan(marathonPlan, marathonContext);
    expect(failedRules(report), report.summary).toEqual([]);
    expect(report.failCount).toBe(0);
    expect(report.passCount).toBe(report.assertions.length);
  });

  it("8-week 10K plan (beginner, 3 days) passes every assertion", () => {
    const report = evaluatePlan(tenKPlan, tenKContext);
    expect(failedRules(report), report.summary).toEqual([]);
    expect(report.failCount).toBe(0);
    expect(report.passCount).toBe(report.assertions.length);
  });

  it("correct fixtures also pass runGuardrails with no warnings", () => {
    const marathonResult = runGuardrails(marathonPlan, 50, "experienced");
    expect(marathonResult.warnings).toEqual([]);
    expect(marathonResult.valid).toBe(true);

    const tenKResult = runGuardrails(tenKPlan, 20, "beginner");
    expect(tenKResult.warnings).toEqual([]);
    expect(tenKResult.valid).toBe(true);
  });

  it("produces a formatted summary with pass/fail counts", () => {
    const report = evaluatePlan(marathonPlan, marathonContext);
    expect(report.summary).toContain(
      `Plan eval: ${report.passCount}/${report.assertions.length} assertions passed`,
    );
    expect(report.summary).toContain("PASS volume_progression");
    expect(report.assertions.every((a) => a.rule && a.details)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Flawed fixture: the harness must catch each planted flaw — and nothing else
// ---------------------------------------------------------------------------

describe("eval harness — flawed 16-week half marathon fixture", () => {
  const report = evaluatePlan(flawedHalfPlan, halfContext);

  it("catches the sawtooth progression (planted flaw 1)", () => {
    const sawtooth = report.assertions.find((a) => a.rule === "no_sawtooth");
    expect(sawtooth?.pass).toBe(false);
    // All three sabotaged rebound weeks (5, 9, 13) are called out.
    expect(sawtooth?.details).toContain("week 5");
    expect(sawtooth?.details).toContain("week 9");
    expect(sawtooth?.details).toContain("week 13");
  });

  it("catches the gutted taper intensity (planted flaw 2)", () => {
    const taperIntensity = report.assertions.find(
      (a) => a.rule === "taper_intensity",
    );
    expect(taperIntensity?.pass).toBe(false);
    expect(taperIntensity?.details).toContain("no quality session");
  });

  it("fails ONLY on the planted flaws — everything else still passes", () => {
    expect(failedRules(report).sort(), report.summary).toEqual([
      "no_sawtooth",
      "taper_intensity",
    ]);
    expect(report.failCount).toBe(2);
  });

  it("runGuardrails flags the gutted taper (its only expected warning)", () => {
    const result = runGuardrails(flawedHalfPlan, 38, "experienced");

    expect(result.valid).toBe(false);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("Week 16 (taper)");
    expect(result.warnings[0]).toContain("no quality session");
    // Guardrails have no sawtooth rule and nothing else trips, so the plan
    // passes through without mechanical adjustments.
    expect(result.adjustments).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Mutation tests: corrupt a good plan and verify the specific rule trips
// ---------------------------------------------------------------------------

describe("eval harness — mutations of a correct plan are caught", () => {
  it("flags a long run moved off the preferred day", () => {
    const mutated = clone(marathonPlan);
    const longRun = mutated.weeks[0].workouts.find((w) => w.type === "long_run")!;
    const saturday = mutated.weeks[0].workouts.find((w) => w.day === "saturday")!;
    longRun.day = "saturday";
    saturday.day = "sunday";

    const report = evaluatePlan(mutated, marathonContext);
    expect(failedRules(report)).toContain("long_run_day");
  });

  it("flags a volume jump beyond the progression band", () => {
    const mutated = clone(marathonPlan);
    mutated.weeks[1].weeklyMileageTargetKm = 80; // 52 -> 80 is a 54% jump

    const report = evaluatePlan(mutated, marathonContext);
    expect(failedRules(report)).toContain("volume_progression");
  });

  it("flags an 80/20 violation when easy runs become intervals", () => {
    const mutated = clone(marathonPlan);
    for (const workout of mutated.weeks[0].workouts) {
      if (workout.type === "easy_run") workout.type = "intervals";
    }

    const report = evaluatePlan(mutated, marathonContext);
    expect(failedRules(report)).toContain("easy_volume_80_20");
  });

  it("flags a wrong taper length for the goal distance", () => {
    const mutated = clone(marathonPlan);
    // Marathon over 12 weeks needs a 2-week taper; relabel week 11 as peak.
    mutated.weeks[10].phase = "peak";
    mutated.phases = [
      { phase: "base", startWeek: 1, endWeek: 5 },
      { phase: "build", startWeek: 6, endWeek: 8 },
      { phase: "peak", startWeek: 9, endWeek: 11 },
      { phase: "taper", startWeek: 12, endWeek: 12 },
    ];

    const report = evaluatePlan(mutated, marathonContext);
    expect(failedRules(report)).toContain("taper_length");
  });

  it("flags insane pace targets", () => {
    const mutated = clone(tenKPlan);
    const firstRun = mutated.weeks[0].workouts.find((w) => w.type === "easy_run")!;
    const step = firstRun.steps[0];
    if (step.type !== "interval") step.targetMin = 60; // 1:00/km — not human

    const report = evaluatePlan(mutated, tenKContext);
    expect(failedRules(report)).toContain("pace_bounds");
  });

  it("flags a missing training day", () => {
    const mutated = clone(tenKPlan);
    const workouts = mutated.weeks[2].workouts;
    workouts.splice(workouts.findIndex((w) => w.type === "tempo"), 1);

    const report = evaluatePlan(mutated, tenKContext);
    expect(failedRules(report)).toContain("days_per_week");
  });
});
