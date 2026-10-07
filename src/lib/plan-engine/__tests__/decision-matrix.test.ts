import { describe, it, expect } from "vitest";
import { evaluateDecisionMatrix } from "../decision-matrix";
import type { ACWRResult, RecoveryReadinessResult, SleepQualityResult } from "@/lib/metrics/derived";
import type { MetricsTrend, TrainingLoadSummary } from "@/types/metrics";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeACWR(overrides: Partial<ACWRResult> = {}): ACWRResult {
  return {
    acuteLoad: 50,
    chronicLoad: 45,
    ratio: 1.11,
    riskBand: "optimal",
    acuteSessions: 4,
    chronicSessions: 16,
    ...overrides,
  };
}

function makeRecovery(overrides: Partial<RecoveryReadinessResult> = {}): RecoveryReadinessResult {
  return {
    score: 72,
    status: "ready",
    confidence: "full",
    components: { hrv: 20, sleep: 18, bodyBattery: 17, stress: 17 },
    missingData: [],
    ...overrides,
  };
}

function makeTrainingLoad(overrides: Partial<TrainingLoadSummary> = {}): TrainingLoadSummary {
  return {
    weekStartDate: "2026-02-09",
    totalDistanceKm: 35,
    totalDurationMinutes: 240,
    workoutsCompleted: 4,
    workoutsPlanned: 5,
    workoutsMissed: 0,
    avgAerobicTrainingEffect: 2.8,
    avgAnaerobicTrainingEffect: 1.5,
    intensityDistribution: { easy: 3, moderate: 1, hard: 1 },
    sessionRpeLoad: null,
    avgRpeScore: null,
    rpeDataPoints: 0,
    ...overrides,
  };
}

const noTrends: MetricsTrend[] = [];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("evaluateDecisionMatrix", () => {
  it("returns no triggers when all metrics are healthy", () => {
    const result = evaluateDecisionMatrix({
      acwr: makeACWR(),
      recovery: makeRecovery(),
      trends: noTrends,
      trainingLoad: makeTrainingLoad(),
    });

    expect(result.shouldAdapt).toBe(false);
    expect(result.severity).toBe("low");
    // May have positive signals
    expect(result.triggers.every((t) => t.severity === "low")).toBe(true);
  });

  describe("ACWR triggers", () => {
    it("triggers medium severity when ACWR > 1.3", () => {
      const result = evaluateDecisionMatrix({
        acwr: makeACWR({ ratio: 1.35, riskBand: "caution" }),
        recovery: makeRecovery(),
        trends: noTrends,
        trainingLoad: makeTrainingLoad(),
      });

      const acwrTrigger = result.triggers.find((t) => t.metric === "acwr");
      expect(acwrTrigger).toBeDefined();
      expect(acwrTrigger!.severity).toBe("medium");
      expect(result.shouldAdapt).toBe(true);
    });

    it("triggers high severity when ACWR > 1.5", () => {
      const result = evaluateDecisionMatrix({
        acwr: makeACWR({ ratio: 1.6, riskBand: "high_risk" }),
        recovery: makeRecovery(),
        trends: noTrends,
        trainingLoad: makeTrainingLoad(),
      });

      const acwrTrigger = result.triggers.find(
        (t) => t.metric === "acwr" && t.severity === "high",
      );
      expect(acwrTrigger).toBeDefined();
      expect(result.severity).toBe("high");
    });

    it("does not trigger when ACWR is null", () => {
      const result = evaluateDecisionMatrix({
        acwr: makeACWR({ ratio: null, riskBand: "undertrained" }),
        recovery: makeRecovery(),
        trends: noTrends,
        trainingLoad: makeTrainingLoad(),
      });

      const acwrTrigger = result.triggers.find(
        (t) => t.metric === "acwr" && t.severity !== "low",
      );
      expect(acwrTrigger).toBeUndefined();
    });
  });

  describe("recovery readiness triggers", () => {
    it("triggers medium when fatigued (score < 50)", () => {
      const result = evaluateDecisionMatrix({
        acwr: makeACWR(),
        recovery: makeRecovery({ score: 42, status: "fatigued" }),
        trends: noTrends,
        trainingLoad: makeTrainingLoad(),
      });

      const recoveryTrigger = result.triggers.find(
        (t) => t.metric === "recoveryReadiness",
      );
      expect(recoveryTrigger).toBeDefined();
      expect(recoveryTrigger!.severity).toBe("medium");
    });

    it("triggers high when depleted (score < 30)", () => {
      const result = evaluateDecisionMatrix({
        acwr: makeACWR(),
        recovery: makeRecovery({ score: 22, status: "depleted" }),
        trends: noTrends,
        trainingLoad: makeTrainingLoad(),
      });

      const recoveryTrigger = result.triggers.find(
        (t) => t.metric === "recoveryReadiness",
      );
      expect(recoveryTrigger).toBeDefined();
      expect(recoveryTrigger!.severity).toBe("high");
    });
  });

  describe("sleep quality triggers", () => {
    it("triggers when sleep quality is low", () => {
      const sleepQuality: SleepQualityResult = {
        index: 40,
        architecture: "poor",
        composition: { deepPercent: 8, remPercent: 12, lightPercent: 65, awakePercent: 15 },
        durationAdequacy: "adequate",
        durationHours: 7.5,
        weeklyTrend: 55,
      };

      const result = evaluateDecisionMatrix({
        acwr: makeACWR(),
        recovery: makeRecovery(),
        sleepQuality,
        trends: noTrends,
        trainingLoad: makeTrainingLoad(),
      });

      const sleepTrigger = result.triggers.find((t) => t.metric === "sleepQuality");
      expect(sleepTrigger).toBeDefined();
      expect(sleepTrigger!.severity).toBe("medium");
    });

    it("triggers high severity for critically short sleep", () => {
      const sleepQuality: SleepQualityResult = {
        index: 35,
        architecture: "poor",
        composition: { deepPercent: 10, remPercent: 15, lightPercent: 60, awakePercent: 15 },
        durationAdequacy: "short",
        durationHours: 5.2,
        weeklyTrend: 50,
      };

      const result = evaluateDecisionMatrix({
        acwr: makeACWR(),
        recovery: makeRecovery(),
        sleepQuality,
        trends: noTrends,
        trainingLoad: makeTrainingLoad(),
      });

      const sleepDurationTrigger = result.triggers.find(
        (t) => t.metric === "sleepDuration",
      );
      expect(sleepDurationTrigger).toBeDefined();
      expect(sleepDurationTrigger!.severity).toBe("high");
    });
  });

  describe("missed workout triggers", () => {
    it("triggers when 2+ workouts missed", () => {
      const result = evaluateDecisionMatrix({
        acwr: makeACWR(),
        recovery: makeRecovery(),
        trends: noTrends,
        trainingLoad: makeTrainingLoad({ workoutsMissed: 2 }),
      });

      const missedTrigger = result.triggers.find(
        (t) => t.metric === "missedWorkouts",
      );
      expect(missedTrigger).toBeDefined();
      expect(missedTrigger!.severity).toBe("medium");
    });

    it("triggers high severity when 3+ missed", () => {
      const result = evaluateDecisionMatrix({
        acwr: makeACWR(),
        recovery: makeRecovery(),
        trends: noTrends,
        trainingLoad: makeTrainingLoad({ workoutsMissed: 3 }),
      });

      const missedTrigger = result.triggers.find(
        (t) => t.metric === "missedWorkouts",
      );
      expect(missedTrigger!.severity).toBe("high");
    });
  });

  describe("compliance rate trigger", () => {
    it("triggers when compliance below 60%", () => {
      const result = evaluateDecisionMatrix({
        acwr: makeACWR(),
        recovery: makeRecovery(),
        trends: noTrends,
        trainingLoad: makeTrainingLoad({
          workoutsPlanned: 5,
          workoutsCompleted: 2,
          workoutsMissed: 0,
        }),
      });

      const complianceTrigger = result.triggers.find(
        (t) => t.metric === "complianceRate",
      );
      expect(complianceTrigger).toBeDefined();
    });
  });

  describe("stress trend trigger", () => {
    it("triggers when stress increasing > 15%", () => {
      const trends: MetricsTrend[] = [
        {
          metric: "stress",
          current7dAvg: 55,
          baseline28dAvg: 42,
          direction: "up",
          changePercent: 31,
          flag: "negative",
        },
      ];

      const result = evaluateDecisionMatrix({
        acwr: makeACWR(),
        recovery: makeRecovery(),
        trends,
        trainingLoad: makeTrainingLoad(),
      });

      const stressTrigger = result.triggers.find((t) => t.metric === "stress");
      expect(stressTrigger).toBeDefined();
    });
  });

  describe("positive signals", () => {
    it("flags ready for progression when recovery high and ACWR optimal", () => {
      const result = evaluateDecisionMatrix({
        acwr: makeACWR({ ratio: 1.05, riskBand: "optimal" }),
        recovery: makeRecovery({ score: 85, status: "ready" }),
        trends: noTrends,
        trainingLoad: makeTrainingLoad(),
      });

      const progressionTrigger = result.triggers.find(
        (t) => t.metric === "readyForProgression",
      );
      expect(progressionTrigger).toBeDefined();
      expect(progressionTrigger!.severity).toBe("low");
    });
  });

  describe("unplanned activity", () => {
    it("triggers medium severity", () => {
      const result = evaluateDecisionMatrix({
        acwr: makeACWR(),
        recovery: makeRecovery(),
        trends: noTrends,
        trainingLoad: makeTrainingLoad(),
        hasUnplannedActivity: true,
      });

      const unplannedTrigger = result.triggers.find(
        (t) => t.type === "unplanned_activity",
      );
      expect(unplannedTrigger).toBeDefined();
      expect(unplannedTrigger!.severity).toBe("medium");
      expect(result.shouldAdapt).toBe(true);
    });
  });
});
