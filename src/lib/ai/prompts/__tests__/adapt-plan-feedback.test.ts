import { describe, it, expect } from "vitest";
import { buildAdaptationPrompt, type AdaptationPromptContext } from "../adapt-plan";
import type { TrainingLoadSummary } from "@/types/metrics";
import type { DecisionResult } from "@/lib/plan-engine/decision-matrix";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMinimalContext(
  overrides: Partial<AdaptationPromptContext> = {},
): AdaptationPromptContext {
  const trainingLoad: TrainingLoadSummary = {
    weekStartDate: "2026-03-20",
    totalDistanceKm: 30,
    totalDurationMinutes: 200,
    workoutsCompleted: 3,
    workoutsPlanned: 5,
    workoutsMissed: 1,
    avgAerobicTrainingEffect: 2.5,
    avgAnaerobicTrainingEffect: 1.2,
    intensityDistribution: { easy: 2, moderate: 1, hard: 0 },
    sessionRpeLoad: null,
    avgRpeScore: null,
    rpeDataPoints: 0,
  };

  const decision: DecisionResult = {
    shouldAdapt: true,
    severity: "medium",
    triggers: [
      { type: "missed_workout", severity: "medium", reason: "Missed 1 of 5 workouts" },
    ],
  };

  return {
    plan: {
      id: "plan-1",
      phase: "build",
      currentWeek: 4,
      totalWeeks: 12,
      weeklyMileageTargetKm: "40",
      planVersion: 2,
    },
    goal: {
      goalType: "half_marathon",
      raceName: "City Run",
      raceDate: "2026-06-15",
      targetDistanceMeters: 21097,
      targetTimeSeconds: 6600,
    },
    upcomingWorkouts: [
      {
        id: "w-1",
        scheduledDate: "2026-03-27",
        workoutType: "easy_run",
        title: "Easy 5k",
        targetDistanceMeters: 5000,
      },
    ],
    recentActivities: [],
    trainingLoad,
    decision,
    triggerType: "weekly_review",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildAdaptationPrompt — feedback context", () => {
  it("includes feedback section when feedbackContext is provided", () => {
    const ctx = makeMinimalContext({
      feedbackContext:
        '- [2026-03-25] (Daily check-in) | Mood: Feeling tired | Stressors: Work stress, Poor sleep',
    });

    const prompt = buildAdaptationPrompt(ctx);

    expect(prompt).toContain("## Recent Athlete Feedback");
    expect(prompt).toContain(
      "The athlete has provided the following context recently:",
    );
    expect(prompt).toContain("Feeling tired");
    expect(prompt).toContain("Work stress, Poor sleep");
  });

  it("omits feedback section when feedbackContext is undefined", () => {
    const ctx = makeMinimalContext({ feedbackContext: undefined });

    const prompt = buildAdaptationPrompt(ctx);

    expect(prompt).not.toContain("## Recent Athlete Feedback");
  });

  it("omits feedback section when feedbackContext is empty string", () => {
    const ctx = makeMinimalContext({ feedbackContext: "" });

    const prompt = buildAdaptationPrompt(ctx);

    expect(prompt).not.toContain("## Recent Athlete Feedback");
  });

  it("places feedback section before Training Load section", () => {
    const ctx = makeMinimalContext({
      feedbackContext: "- [2026-03-25] (Post-workout) | Mood: Feeling great",
    });

    const prompt = buildAdaptationPrompt(ctx);
    const feedbackIndex = prompt.indexOf("## Recent Athlete Feedback");
    const trainingLoadIndex = prompt.indexOf("## Training Load");

    expect(feedbackIndex).toBeGreaterThan(-1);
    expect(trainingLoadIndex).toBeGreaterThan(-1);
    expect(feedbackIndex).toBeLessThan(trainingLoadIndex);
  });
});
