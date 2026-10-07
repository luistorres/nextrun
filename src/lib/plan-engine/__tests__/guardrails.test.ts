import { describe, it, expect } from "vitest";
import { runGuardrails, significantViolations } from "../guardrails";
import type { PlanGenerationOutput, GeneratedWorkout, WorkoutType } from "@/types/plan";
import type { ACWRResult, RecoveryReadinessResult } from "@/lib/metrics/derived";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWorkout(
  day: string,
  type: WorkoutType,
  distanceKm = 5,
): GeneratedWorkout {
  return {
    day,
    type,
    title: `${type} - ${day}`,
    description: "",
    targetDistanceMeters: distanceKm * 1000,
    steps: [],
  };
}

function makePlan(weeks: PlanGenerationOutput["weeks"]): PlanGenerationOutput {
  return {
    totalWeeks: weeks.length,
    phases: [{ phase: "base", startWeek: 1, endWeek: weeks.length }],
    weeks,
  };
}

function makeWeek(
  weekNumber: number,
  workouts: GeneratedWorkout[],
  mileage?: number,
) {
  return {
    weekNumber,
    phase: "base" as const,
    weeklyMileageTargetKm:
      mileage ??
      workouts.reduce(
        (sum, w) => sum + (w.targetDistanceMeters ?? 0) / 1000,
        0,
      ),
    workouts,
  };
}

// ---------------------------------------------------------------------------
// Existing guardrail tests
// ---------------------------------------------------------------------------

describe("runGuardrails", () => {
  it("passes a valid plan with no warnings", () => {
    const plan = makePlan([
      makeWeek(1, [
        makeWorkout("monday", "easy_run", 8),
        makeWorkout("wednesday", "intervals", 6),
        makeWorkout("friday", "easy_run", 8),
        makeWorkout("sunday", "long_run", 15),
        makeWorkout("tuesday", "rest", 0),
        makeWorkout("thursday", "recovery", 4),
        makeWorkout("saturday", "rest", 0),
      ]),
    ]);

    const result = runGuardrails(plan, 41);
    expect(result.warnings).toHaveLength(0);
    expect(result.valid).toBe(true);
  });

  it("caps mileage when exceeding the progression band", () => {
    const plan = makePlan([
      makeWeek(1, [makeWorkout("monday", "easy_run", 30)], 30),
      makeWeek(2, [makeWorkout("monday", "easy_run", 40)], 40),
    ]);

    const result = runGuardrails(plan, 30);
    // experienced band: 30 * 1.2 = 36, but week 2 is 40
    expect(result.adjustments).toHaveLength(1);
    expect(result.adjustments[0].rule).toBe("volume_progression_cap");
    expect(result.plan.weeks[1].weeklyMileageTargetKm).toBe(36);
  });

  it("uses the tighter 10% band for beginners", () => {
    const plan = makePlan([
      makeWeek(1, [makeWorkout("monday", "easy_run", 30)], 30),
      makeWeek(2, [makeWorkout("monday", "easy_run", 40)], 40),
    ]);

    const result = runGuardrails(plan, 30, "beginner");
    // beginner band: 30 * 1.1 = 33
    expect(
      result.adjustments.find((a) => a.rule === "volume_progression_cap")?.after,
    ).toBe(33);
  });

  it("does not let a step-back week lower the progression baseline", () => {
    // 40 → 30 (step-back) → 42. Old behavior capped week 3 at 30 × 1.1 = 33,
    // forcing a sawtooth decline. Correct behavior compares against the last
    // normal week (40), allowing 42 (≤ 40 × 1.2 = 48).
    const plan = makePlan([
      makeWeek(1, [makeWorkout("monday", "easy_run", 40)], 40),
      makeWeek(2, [makeWorkout("monday", "easy_run", 30)], 30),
      makeWeek(3, [makeWorkout("monday", "easy_run", 42)], 42),
    ]);

    const result = runGuardrails(plan, 40);
    expect(
      result.adjustments.filter((a) => a.rule === "volume_progression_cap"),
    ).toHaveLength(0);
    expect(result.plan.weeks[2].weeklyMileageTargetKm).toBe(42);
  });

  it("warns about consecutive hard days", () => {
    const plan = makePlan([
      makeWeek(1, [
        makeWorkout("monday", "intervals", 6),
        makeWorkout("tuesday", "tempo", 8),
        makeWorkout("wednesday", "rest", 0),
        makeWorkout("friday", "easy_run", 6),
      ]),
    ]);

    const result = runGuardrails(plan);
    expect(result.warnings.some((w) => w.includes("consecutive hard"))).toBe(
      true,
    );
  });

  it("warns when 80/20 rule violated", () => {
    const plan = makePlan([
      makeWeek(1, [
        makeWorkout("monday", "intervals", 8),
        makeWorkout("tuesday", "tempo", 8),
        makeWorkout("thursday", "hill_repeats", 6),
        makeWorkout("saturday", "easy_run", 5),
      ]),
    ]);

    const result = runGuardrails(plan);
    expect(result.warnings.some((w) => w.includes("easy volume"))).toBe(true);
  });

  // ─── New guardrail tests ────────────────────────────────────────────

  describe("ACWR guardrail", () => {
    it("downgrades extra hard sessions when ACWR > 1.3", () => {
      const plan = makePlan([
        makeWeek(1, [
          makeWorkout("monday", "easy_run", 8),
          makeWorkout("tuesday", "intervals", 6),
          makeWorkout("thursday", "tempo", 8),
          makeWorkout("saturday", "long_run", 15),
        ]),
      ]);

      const acwr: ACWRResult = {
        acuteLoad: 60,
        chronicLoad: 42,
        ratio: 1.43,
        riskBand: "caution",
        acuteSessions: 5,
        chronicSessions: 16,
      };

      const result = runGuardrails(plan, 37, "experienced", { acwr });

      // Should have ACWR warning
      expect(result.warnings.some((w) => w.includes("ACWR"))).toBe(true);
      // Should have downgraded one hard session to easy
      expect(
        result.adjustments.some((a) => a.rule === "acwr_overload"),
      ).toBe(true);

      // Verify one hard session was converted
      const week1Hard = result.plan.weeks[0].workouts.filter(
        (w) => w.type === "intervals" || w.type === "tempo",
      );
      expect(week1Hard.length).toBeLessThan(2);
    });

    it("blocks mileage increase when ACWR > 1.5", () => {
      const plan = makePlan([
        makeWeek(1, [makeWorkout("monday", "easy_run", 30)], 30),
        makeWeek(2, [makeWorkout("monday", "easy_run", 35)], 35),
      ]);

      const acwr: ACWRResult = {
        acuteLoad: 70,
        chronicLoad: 40,
        ratio: 1.75,
        riskBand: "high_risk",
        acuteSessions: 5,
        chronicSessions: 14,
      };

      const result = runGuardrails(plan, 30, "experienced", { acwr });

      expect(
        result.adjustments.some(
          (a) => a.rule === "acwr_high_risk_mileage_cap",
        ),
      ).toBe(true);
      // Week 2 mileage should be capped to week 1
      expect(result.plan.weeks[1].weeklyMileageTargetKm).toBe(30);
    });

    it("does nothing when ACWR is optimal", () => {
      const plan = makePlan([
        makeWeek(1, [
          makeWorkout("monday", "easy_run", 8),
          makeWorkout("wednesday", "intervals", 6),
          makeWorkout("friday", "tempo", 8),
        ]),
      ]);

      const acwr: ACWRResult = {
        acuteLoad: 45,
        chronicLoad: 42,
        ratio: 1.07,
        riskBand: "optimal",
        acuteSessions: 4,
        chronicSessions: 16,
      };

      const result = runGuardrails(plan, 22, "experienced", { acwr });

      expect(
        result.adjustments.some((a) => a.rule === "acwr_overload"),
      ).toBe(false);
    });
  });

  describe("gray zone guardrail", () => {
    it("warns when > 1 gray zone workout per week", () => {
      const plan = makePlan([
        makeWeek(1, [
          makeWorkout("monday", "easy_run", 8),
          makeWorkout("tuesday", "tempo", 8),
          makeWorkout("thursday", "fartlek", 8),
          makeWorkout("saturday", "long_run", 15),
        ]),
      ]);

      const result = runGuardrails(plan);
      expect(result.warnings.some((w) => w.includes("gray zone"))).toBe(true);
    });

    it("does not warn for single gray zone workout", () => {
      const plan = makePlan([
        makeWeek(1, [
          makeWorkout("monday", "easy_run", 8),
          makeWorkout("wednesday", "tempo", 8),
          makeWorkout("friday", "easy_run", 8),
          makeWorkout("sunday", "long_run", 15),
        ]),
      ]);

      const result = runGuardrails(plan);
      expect(result.warnings.some((w) => w.includes("gray zone"))).toBe(false);
    });

    it("considers intervals as non-gray-zone (true hard)", () => {
      const plan = makePlan([
        makeWeek(1, [
          makeWorkout("monday", "easy_run", 8),
          makeWorkout("wednesday", "intervals", 6),
          makeWorkout("friday", "easy_run", 8),
          makeWorkout("sunday", "long_run", 15),
        ]),
      ]);

      const result = runGuardrails(plan);
      expect(result.warnings.some((w) => w.includes("gray zone"))).toBe(false);
    });
  });

  describe("recovery-informed hard session spacing", () => {
    it("warns about close hard sessions when recovery is fatigued", () => {
      const plan = makePlan([
        makeWeek(1, [
          makeWorkout("monday", "easy_run", 8),
          makeWorkout("tuesday", "intervals", 6),
          makeWorkout("wednesday", "tempo", 8),
          makeWorkout("friday", "easy_run", 8),
          makeWorkout("sunday", "long_run", 15),
        ]),
      ]);

      const recovery: RecoveryReadinessResult = {
        score: 42,
        status: "fatigued",
        confidence: "full",
        components: { hrv: 12, sleep: 10, bodyBattery: 10, stress: 10 },
        missingData: [],
      };

      const result = runGuardrails(plan, 37, "experienced", { recovery });

      expect(
        result.warnings.some(
          (w) => w.includes("Recovery is fatigued") && w.includes("48h"),
        ),
      ).toBe(true);
    });

    it("does not warn about spacing when recovery is ready", () => {
      const plan = makePlan([
        makeWeek(1, [
          makeWorkout("tuesday", "intervals", 6),
          makeWorkout("wednesday", "tempo", 8),
        ]),
      ]);

      const recovery: RecoveryReadinessResult = {
        score: 80,
        status: "ready",
        confidence: "full",
        components: { hrv: 22, sleep: 20, bodyBattery: 20, stress: 18 },
        missingData: [],
      };

      const result = runGuardrails(plan, 14, "experienced", { recovery });

      // Still warns about consecutive hard (rule 4), but NOT about recovery spacing
      expect(
        result.warnings.some((w) => w.includes("Recovery is")),
      ).toBe(false);
    });

    it("warns about spacing with 1-day gap when recovery is moderate", () => {
      const plan = makePlan([
        makeWeek(1, [
          makeWorkout("monday", "intervals", 6),
          makeWorkout("tuesday", "hill_repeats", 5),
          makeWorkout("thursday", "easy_run", 8),
        ]),
      ]);

      const recovery: RecoveryReadinessResult = {
        score: 55,
        status: "moderate",
        confidence: "full",
        components: { hrv: 15, sleep: 14, bodyBattery: 14, stress: 12 },
        missingData: [],
      };

      const result = runGuardrails(plan, 19, "experienced", { recovery });

      expect(
        result.warnings.some(
          (w) => w.includes("Recovery is moderate"),
        ),
      ).toBe(true);
    });
  });
});

describe("significantViolations", () => {
  it("keeps only regen-worthy rules", () => {
    const result = significantViolations([
      { rule: "acwr_overload", directive: "d1" },
      { rule: "volume_progression_cap", directive: "d2" },
      { rule: "acwr_high_risk_mileage_cap", directive: "d3" },
      { rule: "health_constraint_avoid", directive: "d4" },
    ]);
    expect(result.map((v) => v.rule)).toEqual([
      "acwr_overload",
      "acwr_high_risk_mileage_cap",
    ]);
  });
});
