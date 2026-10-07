import { describe, it, expect } from "vitest";
import { checkAdaptationGuardrails } from "../adaptation-guardrails";
import type { AdaptationOutput } from "@/types/plan";
import type { HealthConstraint } from "@/types/health";

const baseWorkout = (over: Record<string, unknown>) => ({
  id: "w1",
  scheduledDate: "2026-08-24",
  dayOfWeek: "monday",
  workoutType: "easy_run",
  title: "Easy run",
  description: "",
  targetDistanceMeters: 8000,
  targetDurationSeconds: null,
  workoutSteps: [],
  ...over,
});

const noChangeOutput: AdaptationOutput = {
  needed: true,
  explanation: { summary: "s", context: "c", keyPoints: ["k"] },
  changes: [],
  updatedWorkouts: [],
};

const avoidHills: HealthConstraint = {
  id: "hc1",
  category: "injury",
  label: "Achilles tendinopathy",
  affectedWorkoutTypes: ["hill_repeats"],
  severity: "avoid",
  activeFrom: "2026-08-01",
};

describe("checkAdaptationGuardrails", () => {
  it("passes a benign proposal", () => {
    const result = checkAdaptationGuardrails({
      workouts: [
        baseWorkout({ id: "w1" }),
        baseWorkout({ id: "w2", scheduledDate: "2026-08-26", dayOfWeek: "wednesday" }),
      ],
      output: noChangeOutput,
      planPhase: "build",
      healthConstraints: [],
    });
    expect(result.rejected).toBe(false);
    expect(result.referentialErrors).toEqual([]);
  });

  it("rejects a proposal that INTRODUCES a health-constrained workout type", () => {
    const output: AdaptationOutput = {
      ...noChangeOutput,
      changes: [
        { workoutId: "w1", change: "modified", to: "Hill repeats", reason: "r" },
      ],
      updatedWorkouts: [
        { day: "monday", type: "hill_repeats", title: "Hill repeats", description: "", steps: [] },
      ],
    };
    const result = checkAdaptationGuardrails({
      workouts: [baseWorkout({})],
      output,
      planPhase: "build",
      healthConstraints: [avoidHills],
    });
    expect(result.rejected).toBe(true);
    expect(result.newViolations[0].rule).toBe("health_constraint_avoid");
  });

  it("does NOT reject when the violation pre-exists and the proposal leaves it untouched", () => {
    const result = checkAdaptationGuardrails({
      workouts: [
        baseWorkout({ id: "w1", workoutType: "hill_repeats", title: "Hills" }),
        baseWorkout({ id: "w2", scheduledDate: "2026-08-26", dayOfWeek: "wednesday" }),
      ],
      output: {
        ...noChangeOutput,
        changes: [{ workoutId: "w2", change: "modified", to: "Recovery jog", reason: "r" }],
        updatedWorkouts: [
          { day: "wednesday", type: "recovery", title: "Recovery jog", description: "", steps: [] },
        ],
      },
      planPhase: "build",
      healthConstraints: [avoidHills],
    });
    expect(result.rejected).toBe(false);
  });

  it("rejects a proposal referencing a workout id outside the upcoming set", () => {
    const result = checkAdaptationGuardrails({
      workouts: [baseWorkout({})],
      output: {
        ...noChangeOutput,
        changes: [{ workoutId: "not-a-real-id", change: "removed", reason: "r" }],
      },
      planPhase: "build",
      healthConstraints: [],
    });
    expect(result.rejected).toBe(true);
    expect(result.referentialErrors.length).toBe(1);
  });

  it("drops removed workouts from the materialized proposal", () => {
    const result = checkAdaptationGuardrails({
      workouts: [
        baseWorkout({ id: "w1" }),
        baseWorkout({ id: "w2", scheduledDate: "2026-08-25", dayOfWeek: "tuesday", workoutType: "tempo", title: "Tempo" }),
      ],
      output: {
        ...noChangeOutput,
        changes: [{ workoutId: "w2", change: "removed", reason: "fatigue" }],
      },
      planPhase: "build",
      healthConstraints: [],
    });
    expect(result.rejected).toBe(false);
    expect(result.materializedWorkoutCount).toBe(1);
  });

  it("rejects adding a hard session when ACWR is elevated, even if the week is already overloaded", () => {
    const hard = (id: string, day: string, date: string, type = "intervals") =>
      baseWorkout({ id, scheduledDate: date, dayOfWeek: day, workoutType: type, title: type });
    const result = checkAdaptationGuardrails({
      workouts: [
        hard("w1", "monday", "2026-08-24"),
        hard("w2", "wednesday", "2026-08-26", "tempo"),
      ],
      output: {
        ...noChangeOutput,
        changes: [{ workoutId: "new-1", change: "added", to: "Hill repeats", reason: "r" }],
        updatedWorkouts: [
          { day: "2026-08-28", type: "hill_repeats", title: "Hill repeats", description: "", steps: [] },
        ],
      },
      planPhase: "build",
      athleteContext: { acwr: { ratio: 1.4 } } as never,
      healthConstraints: [],
    });
    expect(result.rejected).toBe(true);
    expect(result.newViolations.some((v) => v.rule === "acwr_hard_session_increase")).toBe(true);
  });

  it("materializes duplicate added changes separately", () => {
    const added = { day: "monday", type: "easy_run" as const, title: "Extra easy", description: "", steps: [] };
    const result = checkAdaptationGuardrails({
      workouts: [baseWorkout({})],
      output: {
        ...noChangeOutput,
        changes: [
          { workoutId: "dup", change: "added", to: "Extra easy", reason: "r" },
          { workoutId: "dup", change: "added", to: "Extra easy", reason: "r" },
        ],
        updatedWorkouts: [added, added],
      },
      planPhase: "build",
      healthConstraints: [],
    });
    expect(result.materializedWorkoutCount).toBe(3);
    expect(result.referentialErrors).toEqual([]);
  });

  it("never fires volume violations on the partial-week window", () => {
    const heavy = (id: string, date: string, day: string) =>
      baseWorkout({ id, scheduledDate: date, dayOfWeek: day, targetDistanceMeters: 20000 });
    const result = checkAdaptationGuardrails({
      workouts: [
        heavy("w1", "2026-08-22", "saturday"),
        heavy("w2", "2026-08-24", "monday"),
        heavy("w3", "2026-08-26", "wednesday"),
        heavy("w4", "2026-08-28", "friday"),
      ],
      output: {
        ...noChangeOutput,
        changes: [{ workoutId: "w3", change: "modified", to: "Steady 20k", reason: "r" }],
        updatedWorkouts: [
          {
            day: "wednesday",
            type: "easy_run",
            title: "Steady 20k",
            description: "",
            targetDistanceMeters: 20000,
            steps: [],
          },
        ],
      },
      planPhase: "build",
      healthConstraints: [],
    });
    expect(result.rejected).toBe(false);
    expect(result.warnings.some((w) => /mileage|volume/i.test(w))).toBe(false);
  });

  it("does NOT reject a load-REDUCING proposal when a constrained workout already sits in an overloaded week", () => {
    const result = checkAdaptationGuardrails({
      workouts: [
        baseWorkout({ id: "w1", workoutType: "hill_repeats", title: "Hills" }),
        baseWorkout({ id: "w2", scheduledDate: "2026-08-26", dayOfWeek: "wednesday", workoutType: "tempo", title: "Tempo" }),
      ],
      output: {
        ...noChangeOutput,
        changes: [{ workoutId: "w2", change: "removed", reason: "load too high" }],
      },
      planPhase: "build",
      athleteContext: { acwr: { ratio: 1.4 } } as never,
      healthConstraints: [avoidHills],
    });
    expect(result.rejected).toBe(false);
  });

  it("does NOT reject swapping a run for cross-training at high ACWR", () => {
    const result = checkAdaptationGuardrails({
      workouts: [
        baseWorkout({ id: "w1", targetDistanceMeters: 10000 }),
        baseWorkout({ id: "w2", scheduledDate: "2026-08-26", dayOfWeek: "wednesday" }),
      ],
      output: {
        ...noChangeOutput,
        changes: [{ workoutId: "w1", change: "replaced", to: "Pool session", reason: "r" }],
        updatedWorkouts: [
          {
            day: "monday",
            type: "cross_training",
            title: "Pool session",
            description: "",
            steps: [
              {
                order: 1,
                type: "steady",
                durationType: "time",
                durationValue: 7200,
                targetType: "open",
              },
            ],
          },
        ],
      },
      planPhase: "build",
      athleteContext: { acwr: { ratio: 1.6 } } as never,
      healthConstraints: [],
    });
    expect(result.rejected).toBe(false);
  });

  it("rejects conflicting changes targeting the same workout", () => {
    const result = checkAdaptationGuardrails({
      workouts: [
        baseWorkout({}),
        baseWorkout({ id: "w2", scheduledDate: "2026-08-26", dayOfWeek: "wednesday" }),
      ],
      output: {
        ...noChangeOutput,
        changes: [
          { workoutId: "w1", change: "removed", reason: "r" },
          { workoutId: "w1", change: "modified", to: "Easy again", reason: "r" },
        ],
        updatedWorkouts: [
          { day: "monday", type: "easy_run", title: "Easy again", description: "", steps: [] },
        ],
      },
      planPhase: "build",
      healthConstraints: [],
    });
    expect(result.rejected).toBe(true);
    expect(result.referentialErrors).toEqual(["duplicate changes for workout w1"]);
  });

  it("buckets an ISO-dated added workout into its own week for the volume delta", () => {
    const result = checkAdaptationGuardrails({
      workouts: [
        baseWorkout({ id: "w1", targetDistanceMeters: 100000 }),
        baseWorkout({ id: "w2", scheduledDate: "2026-08-31", targetDistanceMeters: 2000 }),
      ],
      output: {
        ...noChangeOutput,
        changes: [{ workoutId: "new-1", change: "added", to: "Extra easy", reason: "r" }],
        updatedWorkouts: [
          { day: "2026-09-01", type: "easy_run", title: "Extra easy", description: "", targetDistanceMeters: 4000, steps: [] },
        ],
      },
      planPhase: "build",
      athleteContext: { acwr: { ratio: 1.6 } } as never,
      healthConstraints: [],
    });
    expect(result.rejected).toBe(true);
    expect(result.newViolations.some((v) => v.rule === "acwr_volume_increase")).toBe(true);
  });

  it("rejects a swap that moves a constrained workout type to another day", () => {
    const result = checkAdaptationGuardrails({
      workouts: [
        baseWorkout({ id: "w1", workoutType: "hill_repeats", title: "Hills" }),
        baseWorkout({ id: "w2", scheduledDate: "2026-08-26", dayOfWeek: "wednesday" }),
      ],
      output: {
        ...noChangeOutput,
        changes: [
          { workoutId: "w1", change: "removed", reason: "r" },
          { workoutId: "w2", change: "modified", to: "Hill repeats", reason: "r" },
        ],
        updatedWorkouts: [
          { day: "wednesday", type: "hill_repeats", title: "Hill repeats", description: "", steps: [] },
        ],
      },
      planPhase: "build",
      healthConstraints: [avoidHills],
    });
    expect(result.rejected).toBe(true);
    expect(result.newViolations.some((v) => v.rule === "health_constraint_avoid")).toBe(true);
  });

  it("does NOT reject when the constraint expired before the changed workout's date", () => {
    const expiredHills: HealthConstraint = { ...avoidHills, id: "hc2", activeUntil: "2026-08-10" };
    const result = checkAdaptationGuardrails({
      workouts: [
        baseWorkout({}),
        baseWorkout({ id: "w2", scheduledDate: "2026-08-26", dayOfWeek: "wednesday" }),
      ],
      output: {
        ...noChangeOutput,
        changes: [{ workoutId: "w2", change: "modified", to: "Hill repeats", reason: "r" }],
        updatedWorkouts: [
          { day: "wednesday", type: "hill_repeats", title: "Hill repeats", description: "", steps: [] },
        ],
      },
      planPhase: "build",
      healthConstraints: [expiredHills],
    });
    expect(result.rejected).toBe(false);
  });

  it("counts interval steps as hard regardless of declared type", () => {
    const result = checkAdaptationGuardrails({
      workouts: [
        baseWorkout({}),
        baseWorkout({ id: "w2", scheduledDate: "2026-08-26", dayOfWeek: "wednesday", workoutType: "tempo", title: "Tempo" }),
      ],
      output: {
        ...noChangeOutput,
        changes: [{ workoutId: "w1", change: "modified", to: "Easy with surges", reason: "r" }],
        updatedWorkouts: [
          {
            day: "monday",
            type: "easy_run",
            title: "Easy with surges",
            description: "",
            targetDistanceMeters: 8000,
            steps: [
              {
                order: 1,
                type: "interval",
                repeatCount: 6,
                workStep: { durationType: "time", durationValue: 60, targetType: "open" },
                restStep: { durationType: "time", durationValue: 60, targetType: "open" },
              },
            ],
          },
        ],
      },
      planPhase: "build",
      athleteContext: { acwr: { ratio: 1.4 } } as never,
      healthConstraints: [],
    });
    expect(result.rejected).toBe(true);
    expect(result.newViolations.some((v) => v.rule === "acwr_hard_session_increase")).toBe(true);
  });

  it("allows the single hard session rule 7 permits at moderately elevated ACWR", () => {
    const result = checkAdaptationGuardrails({
      workouts: [
        baseWorkout({}),
        baseWorkout({ id: "w2", scheduledDate: "2026-08-26", dayOfWeek: "wednesday" }),
      ],
      output: {
        ...noChangeOutput,
        changes: [{ workoutId: "w1", change: "modified", to: "Tempo", reason: "r" }],
        updatedWorkouts: [
          { day: "monday", type: "tempo", title: "Tempo", description: "", targetDistanceMeters: 8000, steps: [] },
        ],
      },
      planPhase: "build",
      athleteContext: { acwr: { ratio: 1.35 } } as never,
      healthConstraints: [],
    });
    expect(result.rejected).toBe(false);
  });

  it("rejects a long-run volume increase at elevated ACWR", () => {
    const result = checkAdaptationGuardrails({
      workouts: [
        baseWorkout({ id: "w1", workoutType: "long_run", title: "Long run", targetDistanceMeters: 16000 }),
      ],
      output: {
        ...noChangeOutput,
        changes: [{ workoutId: "w1", change: "modified", to: "Long run extended", reason: "r" }],
        updatedWorkouts: [
          { day: "monday", type: "long_run", title: "Long run extended", description: "", targetDistanceMeters: 20000, steps: [] },
        ],
      },
      planPhase: "build",
      athleteContext: { acwr: { ratio: 1.45 } } as never,
      healthConstraints: [],
    });
    expect(result.rejected).toBe(true);
    expect(result.newViolations.some((v) => v.rule === "acwr_long_run_increase")).toBe(true);
  });

  it("inherits omitted numeric targets from the original workout", () => {
    const result = checkAdaptationGuardrails({
      workouts: [baseWorkout({ id: "w1", targetDistanceMeters: 20000 })],
      output: {
        ...noChangeOutput,
        changes: [{ workoutId: "w1", change: "modified", to: "Long run", reason: "r" }],
        updatedWorkouts: [
          { day: "monday", type: "long_run", title: "Long run", description: "", steps: [] },
        ],
      },
      planPhase: "build",
      athleteContext: { acwr: { ratio: 1.45 } } as never,
      healthConstraints: [],
    });
    expect(result.rejected).toBe(true);
    expect(result.newViolations.some((v) => v.rule === "acwr_long_run_increase")).toBe(true);
  });

  it("counts time-based interval steps toward the volume delta", () => {
    const result = checkAdaptationGuardrails({
      workouts: [baseWorkout({ id: "w1", targetDistanceMeters: 4000 })],
      output: {
        ...noChangeOutput,
        changes: [{ workoutId: "w1", change: "modified", to: "Easy with blocks", reason: "r" }],
        updatedWorkouts: [
          {
            day: "monday",
            type: "easy_run",
            title: "Easy with blocks",
            description: "",
            targetDistanceMeters: 4000,
            steps: [
              {
                order: 1,
                type: "interval",
                repeatCount: 8,
                workStep: { durationType: "time", durationValue: 180, targetType: "open" },
                restStep: { durationType: "time", durationValue: 180, targetType: "open" },
              },
            ],
          },
        ],
      },
      planPhase: "build",
      athleteContext: { acwr: { ratio: 1.6 } } as never,
      healthConstraints: [],
    });
    expect(result.rejected).toBe(true);
    expect(result.newViolations.some((v) => v.rule === "acwr_volume_increase")).toBe(true);
  });

  it("does NOT reject a load-reducing modify of an already-constrained workout", () => {
    const result = checkAdaptationGuardrails({
      workouts: [
        baseWorkout({ id: "w1", workoutType: "hill_repeats", title: "Hills", targetDistanceMeters: 8000 }),
      ],
      output: {
        ...noChangeOutput,
        changes: [{ workoutId: "w1", change: "modified", to: "Shorter hills", reason: "r" }],
        updatedWorkouts: [
          { day: "monday", type: "hill_repeats", title: "Shorter hills", description: "", targetDistanceMeters: 5000, steps: [] },
        ],
      },
      planPhase: "build",
      healthConstraints: [avoidHills],
    });
    expect(result.rejected).toBe(false);
  });

  it("matches an avoid-intervals constraint against interval steps on a soft type", () => {
    const avoidIntervals: HealthConstraint = {
      id: "hc3",
      category: "injury",
      label: "Hamstring strain",
      affectedWorkoutTypes: ["intervals"],
      severity: "avoid",
      activeFrom: "2026-08-01",
    };
    const result = checkAdaptationGuardrails({
      workouts: [baseWorkout({})],
      output: {
        ...noChangeOutput,
        changes: [{ workoutId: "w1", change: "modified", to: "Easy with surges", reason: "r" }],
        updatedWorkouts: [
          {
            day: "monday",
            type: "easy_run",
            title: "Easy with surges",
            description: "",
            steps: [
              {
                order: 1,
                type: "interval",
                repeatCount: 4,
                workStep: { durationType: "time", durationValue: 60, targetType: "open" },
                restStep: { durationType: "time", durationValue: 60, targetType: "open" },
              },
            ],
          },
        ],
      },
      planPhase: "build",
      healthConstraints: [avoidIntervals],
    });
    expect(result.rejected).toBe(true);
    expect(result.newViolations.some((v) => v.rule === "health_constraint_avoid")).toBe(true);
  });

  it("does NOT count interval steps on cross-training as a hard session", () => {
    const result = checkAdaptationGuardrails({
      workouts: [
        baseWorkout({}),
        baseWorkout({ id: "w2", scheduledDate: "2026-08-26", dayOfWeek: "wednesday", workoutType: "tempo", title: "Tempo" }),
      ],
      output: {
        ...noChangeOutput,
        changes: [{ workoutId: "new-1", change: "added", to: "Aqua intervals", reason: "r" }],
        updatedWorkouts: [
          {
            day: "2026-08-27",
            type: "cross_training",
            title: "Aqua intervals",
            description: "",
            steps: [
              {
                order: 1,
                type: "interval",
                repeatCount: 10,
                workStep: { durationType: "time", durationValue: 120, targetType: "open" },
                restStep: { durationType: "time", durationValue: 60, targetType: "open" },
              },
            ],
          },
        ],
      },
      planPhase: "build",
      athleteContext: { acwr: { ratio: 1.4 } } as never,
      healthConstraints: [],
    });
    expect(result.rejected).toBe(false);
  });

  it("keeps a modified workout on its original day even when the sub lies about it", () => {
    const result = checkAdaptationGuardrails({
      workouts: [
        baseWorkout({}),
        baseWorkout({ id: "w2", scheduledDate: "2026-08-25", dayOfWeek: "tuesday", workoutType: "tempo", title: "Tempo" }),
      ],
      output: {
        ...noChangeOutput,
        changes: [{ workoutId: "w1", change: "modified", to: "Intervals", reason: "r" }],
        updatedWorkouts: [
          { day: "saturday", type: "intervals", title: "Intervals", description: "", steps: [] },
        ],
      },
      planPhase: "build",
      healthConstraints: [],
    });
    expect(result.warnings.some((w) => /consecutive hard/i.test(w))).toBe(true);
  });

  it("rejects an added change with no matching updatedWorkouts entry", () => {
    const result = checkAdaptationGuardrails({
      workouts: [baseWorkout({})],
      output: {
        ...noChangeOutput,
        changes: [{ workoutId: "new-1", change: "added", to: "Mystery workout", reason: "r" }],
        updatedWorkouts: [],
      },
      planPhase: "build",
      healthConstraints: [],
    });
    expect(result.rejected).toBe(true);
    expect(result.referentialErrors).toEqual([
      "added change new-1 has no matching updatedWorkouts entry",
    ]);
  });

  it("allows a small recovery add into an empty week at high ACWR", () => {
    const result = checkAdaptationGuardrails({
      workouts: [baseWorkout({})],
      output: {
        ...noChangeOutput,
        changes: [{ workoutId: "new-1", change: "added", to: "Recovery jog", reason: "r" }],
        updatedWorkouts: [
          { day: "2026-09-02", type: "recovery", title: "Recovery jog", description: "", targetDistanceMeters: 3000, steps: [] },
        ],
      },
      planPhase: "build",
      athleteContext: { acwr: { ratio: 1.6 } } as never,
      healthConstraints: [],
    });
    expect(result.rejected).toBe(false);
  });
});
