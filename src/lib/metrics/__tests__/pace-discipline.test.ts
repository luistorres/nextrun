import { describe, it, expect } from "vitest";
import {
  calculatePaceDiscipline,
  type PaceDisciplineLap,
} from "../workout-execution";
import type {
  WorkoutStep,
  SimpleWorkoutStep,
  IntervalWorkoutStep,
} from "@/types/plan";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function lap(
  lapIndex: number,
  distanceM: number | null,
  paceSecPerKm: number | null,
): PaceDisciplineLap {
  return {
    lapIndex,
    totalDistanceMeters: distanceM,
    avgPaceSecondsPerKm: paceSecPerKm,
  };
}

function steadyStep(
  order: number,
  opts: Partial<SimpleWorkoutStep> = {},
): SimpleWorkoutStep {
  return {
    order,
    type: "steady",
    durationType: "distance",
    durationValue: 5000,
    targetType: "pace",
    targetMin: 300,
    targetMax: 320,
    ...opts,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("calculatePaceDiscipline", () => {
  it("returns null when there are no pace-targeted steps", () => {
    const steps: WorkoutStep[] = [
      steadyStep(1, { targetType: "heart_rate", targetMin: 140, targetMax: 155 }),
      steadyStep(2, { targetType: "open", targetMin: undefined, targetMax: undefined }),
    ];
    expect(calculatePaceDiscipline([lap(0, 5000, 310)], steps)).toBeNull();
  });

  it("returns null when there are no laps", () => {
    expect(calculatePaceDiscipline([], [steadyStep(1)])).toBeNull();
  });

  it("returns null when no lap has usable distance + pace", () => {
    const laps = [lap(0, null, 310), lap(1, 1000, null), lap(2, 0, 310)];
    expect(calculatePaceDiscipline(laps, [steadyStep(1)])).toBeNull();
  });

  it("scores 100% when all laps are inside the prescribed range", () => {
    // Single 5km steady step at 300-320 s/km, run as 5 × 1km laps in range
    const laps = [
      lap(0, 1000, 305),
      lap(1, 1000, 312),
      lap(2, 1000, 300), // inclusive lower bound
      lap(3, 1000, 320), // inclusive upper bound
      lap(4, 1000, 318),
    ];
    const result = calculatePaceDiscipline(laps, [steadyStep(1)]);
    expect(result).toEqual({ paceDisciplinePct: 100, lapsAnalyzed: 5 });
  });

  it("weights in-zone fraction by lap distance", () => {
    // 3km in zone, 1km too fast → 75%
    const laps = [
      lap(0, 2000, 310),
      lap(1, 1000, 290), // too fast (faster than 300 s/km bound)
      lap(2, 1000, 315),
    ];
    const result = calculatePaceDiscipline(laps, [steadyStep(1, { durationValue: 4000 })]);
    expect(result).toEqual({ paceDisciplinePct: 75, lapsAnalyzed: 3 });
  });

  it("aligns laps to multiple steps by cumulative distance (greedy)", () => {
    // warmup 2km open, then 4km tempo @ 270-285
    const steps: WorkoutStep[] = [
      steadyStep(1, {
        type: "warmup",
        durationValue: 2000,
        targetType: "open",
        targetMin: undefined,
        targetMax: undefined,
      }),
      steadyStep(2, { durationValue: 4000, targetMin: 270, targetMax: 285 }),
    ];
    // Warmup lap at slow pace must NOT count against the tempo target
    const laps = [
      lap(0, 2000, 360), // warmup — consumed by step 1 (distance-based)
      lap(1, 2000, 275), // tempo, in zone
      lap(2, 2000, 295), // tempo, too slow
    ];
    const result = calculatePaceDiscipline(laps, steps);
    expect(result).toEqual({ paceDisciplinePct: 50, lapsAnalyzed: 2 });
  });

  it("expands interval repeats; inestimable rest steps consume one lap each", () => {
    // 3 × (1km work @ 240-255 / 90s jog recovery without pace target)
    const intervals: IntervalWorkoutStep = {
      order: 1,
      type: "interval",
      repeatCount: 3,
      workStep: {
        durationType: "distance",
        durationValue: 1000,
        targetType: "pace",
        targetMin: 240,
        targetMax: 255,
      },
      restStep: {
        durationType: "time",
        durationValue: 90,
        targetType: "open",
      },
    };
    // Device auto-laps each step: work, rest, work, rest, work
    const laps = [
      lap(0, 1000, 248), // work 1: in zone
      lap(1, 250, 420), // recovery — untargeted
      lap(2, 1000, 260), // work 2: too slow
      lap(3, 250, 430), // recovery
      lap(4, 1000, 250), // work 3: in zone
    ];
    const result = calculatePaceDiscipline(laps, [intervals]);
    // 2000m of 3000m work distance in zone → 67%
    expect(result).toEqual({ paceDisciplinePct: 67, lapsAnalyzed: 3 });
  });

  it("estimates distance for time-based pace-targeted steps from the pace midpoint", () => {
    // 20 min tempo @ 300 s/km midpoint → ~4km estimated
    const steps: WorkoutStep[] = [
      steadyStep(1, {
        durationType: "time",
        durationValue: 1200,
        targetMin: 290,
        targetMax: 310,
      }),
      steadyStep(2, {
        type: "cooldown",
        durationValue: 1000,
        targetType: "open",
        targetMin: undefined,
        targetMax: undefined,
      }),
    ];
    const laps = [
      lap(0, 2000, 295), // tempo
      lap(1, 2000, 305), // tempo (cumulative 4000 ≥ 0.9 × 4000 → advance)
      lap(2, 1000, 400), // cooldown — untargeted
    ];
    const result = calculatePaceDiscipline(laps, steps);
    expect(result).toEqual({ paceDisciplinePct: 100, lapsAnalyzed: 2 });
  });

  it("assigns trailing laps to the final step (extended cooldown / extra laps)", () => {
    const steps: WorkoutStep[] = [steadyStep(1, { durationValue: 2000 })];
    const laps = [
      lap(0, 2000, 310), // in zone, consumes the only step
      lap(1, 1000, 400), // extra lap — still scored against the last step
    ];
    const result = calculatePaceDiscipline(laps, steps);
    // 2000 of 3000 in zone → 67%, 2 laps analyzed
    expect(result).toEqual({ paceDisciplinePct: 67, lapsAnalyzed: 2 });
  });

  it("treats a missing bound as unbounded on that side", () => {
    const steps: WorkoutStep[] = [
      steadyStep(1, { targetMin: undefined, targetMax: 320 }), // anything ≤ 320
    ];
    const laps = [lap(0, 1000, 200), lap(1, 1000, 350)];
    const result = calculatePaceDiscipline(laps, steps);
    expect(result).toEqual({ paceDisciplinePct: 50, lapsAnalyzed: 2 });
  });

  it("normalizes swapped pace bounds", () => {
    const steps: WorkoutStep[] = [
      steadyStep(1, { targetMin: 320, targetMax: 300 }), // swapped
    ];
    const result = calculatePaceDiscipline([lap(0, 1000, 310)], steps);
    expect(result).toEqual({ paceDisciplinePct: 100, lapsAnalyzed: 1 });
  });

  it("respects step ordering via the order field", () => {
    // Steps provided out of order: tempo (order 2) before warmup (order 1)
    const steps: WorkoutStep[] = [
      steadyStep(2, { durationValue: 2000, targetMin: 270, targetMax: 285 }),
      steadyStep(1, {
        type: "warmup",
        durationValue: 2000,
        targetType: "open",
        targetMin: undefined,
        targetMax: undefined,
      }),
    ];
    const laps = [
      lap(0, 2000, 360), // warmup
      lap(1, 2000, 275), // tempo in zone
    ];
    const result = calculatePaceDiscipline(laps, steps);
    expect(result).toEqual({ paceDisciplinePct: 100, lapsAnalyzed: 1 });
  });

  it("sorts laps by lapIndex before alignment", () => {
    const steps: WorkoutStep[] = [
      steadyStep(1, {
        type: "warmup",
        durationValue: 1000,
        targetType: "open",
        targetMin: undefined,
        targetMax: undefined,
      }),
      steadyStep(2, { durationValue: 1000 }),
    ];
    // Laps deliberately out of order
    const laps = [lap(1, 1000, 310), lap(0, 1000, 400)];
    const result = calculatePaceDiscipline(laps, steps);
    expect(result).toEqual({ paceDisciplinePct: 100, lapsAnalyzed: 1 });
  });
});
