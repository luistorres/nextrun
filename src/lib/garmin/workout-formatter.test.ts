import { describe, it, expect } from "vitest";
import {
  formatStepsForGarmin,
  buildGarminWorkout,
  paceStringToSecondsPerKm,
  secondsPerKmToPaceString,
  kmToMeters,
  minutesToSeconds,
} from "./workout-formatter";
import type { WorkoutStep } from "@/types/plan";
import type {
  GarminWorkoutStepDTO,
  GarminWorkoutRepeatGroupDTO,
} from "@/types/garmin";

// ─── Utility Conversions ────────────────────────────────────────────────────

describe("paceStringToSecondsPerKm", () => {
  it("converts 5:00 to 300 seconds", () => {
    expect(paceStringToSecondsPerKm("5:00")).toBe(300);
  });

  it("converts 4:30 to 270 seconds", () => {
    expect(paceStringToSecondsPerKm("4:30")).toBe(270);
  });

  it("converts 6:45 to 405 seconds", () => {
    expect(paceStringToSecondsPerKm("6:45")).toBe(405);
  });

  it("converts 3:45 to 225 seconds", () => {
    expect(paceStringToSecondsPerKm("3:45")).toBe(225);
  });
});

describe("secondsPerKmToPaceString", () => {
  it("converts 300 to 5:00", () => {
    expect(secondsPerKmToPaceString(300)).toBe("5:00");
  });

  it("converts 270 to 4:30", () => {
    expect(secondsPerKmToPaceString(270)).toBe("4:30");
  });

  it("converts 405 to 6:45", () => {
    expect(secondsPerKmToPaceString(405)).toBe("6:45");
  });

  it("handles exact minutes with zero seconds", () => {
    expect(secondsPerKmToPaceString(360)).toBe("6:00");
  });
});

describe("kmToMeters", () => {
  it("converts 1 km to 1000 meters", () => {
    expect(kmToMeters(1)).toBe(1000);
  });

  it("converts 5 km to 5000 meters", () => {
    expect(kmToMeters(5)).toBe(5000);
  });

  it("converts 0.8 km to 800 meters", () => {
    expect(kmToMeters(0.8)).toBe(800);
  });

  it("converts 21.1 km to 21100 meters", () => {
    expect(kmToMeters(21.1)).toBe(21100);
  });

  it("rounds to nearest meter for precision", () => {
    expect(kmToMeters(0.4)).toBe(400);
    expect(kmToMeters(1.609)).toBe(1609);
  });
});

describe("minutesToSeconds", () => {
  it("converts 10 minutes to 600 seconds", () => {
    expect(minutesToSeconds(10)).toBe(600);
  });

  it("converts 1.5 minutes to 90 seconds", () => {
    expect(minutesToSeconds(1.5)).toBe(90);
  });

  it("converts 45 minutes to 2700 seconds", () => {
    expect(minutesToSeconds(45)).toBe(2700);
  });
});

// ─── Easy Run ───────────────────────────────────────────────────────────────

describe("formatStepsForGarmin — easy run", () => {
  const easyRunSteps: WorkoutStep[] = [
    {
      order: 1,
      type: "steady",
      durationType: "time",
      durationValue: 2400, // 40 minutes in seconds
      targetType: "pace",
      targetMin: 330, // 5:30/km
      targetMax: 360, // 6:00/km
      description: "Easy pace run",
    },
  ];

  it("produces a single ACTIVE step", () => {
    const result = formatStepsForGarmin(easyRunSteps);
    expect(result).toHaveLength(1);

    const step = result[0] as GarminWorkoutStepDTO;
    expect(step.type).toBe("WorkoutStep");
    expect(step.stepType).toBe("ACTIVE");
  });

  it("sets TIME end condition with correct seconds", () => {
    const result = formatStepsForGarmin(easyRunSteps);
    const step = result[0] as GarminWorkoutStepDTO;
    expect(step.endCondition).toBe("TIME");
    expect(step.endConditionValue).toBe(2400);
  });

  it("sets pace targets in seconds/km", () => {
    const result = formatStepsForGarmin(easyRunSteps);
    const step = result[0] as GarminWorkoutStepDTO;
    expect(step.targetType).toBe("PACE");
    expect(step.targetValueLow).toBe(330);
    expect(step.targetValueHigh).toBe(360);
  });

  it("preserves step description", () => {
    const result = formatStepsForGarmin(easyRunSteps);
    const step = result[0] as GarminWorkoutStepDTO;
    expect(step.description).toBe("Easy pace run");
  });

  it("assigns stepOrder starting at 1", () => {
    const result = formatStepsForGarmin(easyRunSteps);
    const step = result[0] as GarminWorkoutStepDTO;
    expect(step.stepOrder).toBe(1);
  });
});

// ─── Interval Workout ───────────────────────────────────────────────────────

describe("formatStepsForGarmin — interval workout", () => {
  const intervalSteps: WorkoutStep[] = [
    {
      order: 1,
      type: "warmup",
      durationType: "time",
      durationValue: 600, // 10 min
      targetType: "open",
      description: "Easy jog warmup",
    },
    {
      order: 2,
      type: "interval",
      repeatCount: 5,
      workStep: {
        durationType: "distance",
        durationValue: 800, // 800 meters
        targetType: "pace",
        targetMin: 270, // 4:30/km
        targetMax: 285, // 4:45/km
      },
      restStep: {
        durationType: "distance",
        durationValue: 400, // 400m recovery
        targetType: "open",
      },
    },
    {
      order: 3,
      type: "cooldown",
      durationType: "time",
      durationValue: 600, // 10 min
      targetType: "open",
      description: "Easy jog cooldown",
    },
  ];

  it("produces 3 top-level steps (warmup, repeat group, cooldown)", () => {
    const result = formatStepsForGarmin(intervalSteps);
    expect(result).toHaveLength(3);
  });

  it("first step is WARMUP with TIME", () => {
    const result = formatStepsForGarmin(intervalSteps);
    const warmup = result[0] as GarminWorkoutStepDTO;
    expect(warmup.type).toBe("WorkoutStep");
    expect(warmup.stepType).toBe("WARMUP");
    expect(warmup.endCondition).toBe("TIME");
    expect(warmup.endConditionValue).toBe(600);
    expect(warmup.targetType).toBe("OPEN");
  });

  it("second step is a RepeatGroupDTO with 5 iterations", () => {
    const result = formatStepsForGarmin(intervalSteps);
    const group = result[1] as GarminWorkoutRepeatGroupDTO;
    expect(group.type).toBe("WorkoutRepeatGroupDTO");
    expect(group.numberOfIterations).toBe(5);
    expect(group.steps).toHaveLength(2);
  });

  it("repeat group has ACTIVE work step with distance and pace", () => {
    const result = formatStepsForGarmin(intervalSteps);
    const group = result[1] as GarminWorkoutRepeatGroupDTO;
    const work = group.steps[0];
    expect(work.stepType).toBe("ACTIVE");
    expect(work.endCondition).toBe("DISTANCE");
    expect(work.endConditionValue).toBe(800);
    expect(work.targetType).toBe("PACE");
    expect(work.targetValueLow).toBe(270);
    expect(work.targetValueHigh).toBe(285);
  });

  it("repeat group has RECOVERY rest step with distance", () => {
    const result = formatStepsForGarmin(intervalSteps);
    const group = result[1] as GarminWorkoutRepeatGroupDTO;
    const rest = group.steps[1];
    expect(rest.stepType).toBe("RECOVERY");
    expect(rest.endCondition).toBe("DISTANCE");
    expect(rest.endConditionValue).toBe(400);
    expect(rest.targetType).toBe("OPEN");
  });

  it("third step is COOLDOWN with TIME", () => {
    const result = formatStepsForGarmin(intervalSteps);
    const cooldown = result[2] as GarminWorkoutStepDTO;
    expect(cooldown.type).toBe("WorkoutStep");
    expect(cooldown.stepType).toBe("COOLDOWN");
    expect(cooldown.endCondition).toBe("TIME");
    expect(cooldown.endConditionValue).toBe(600);
    expect(cooldown.targetType).toBe("OPEN");
  });

  it("assigns sequential stepOrder across all top-level steps", () => {
    const result = formatStepsForGarmin(intervalSteps);
    expect((result[0] as GarminWorkoutStepDTO).stepOrder).toBe(1);
    expect((result[1] as GarminWorkoutRepeatGroupDTO).stepOrder).toBe(2);
    expect((result[2] as GarminWorkoutStepDTO).stepOrder).toBe(3);
  });

  it("inner repeat steps have their own sequential ordering (1, 2)", () => {
    const result = formatStepsForGarmin(intervalSteps);
    const group = result[1] as GarminWorkoutRepeatGroupDTO;
    expect(group.steps[0].stepOrder).toBe(1);
    expect(group.steps[1].stepOrder).toBe(2);
  });
});

// ─── Tempo Run ──────────────────────────────────────────────────────────────

describe("formatStepsForGarmin — tempo run", () => {
  const tempoSteps: WorkoutStep[] = [
    {
      order: 1,
      type: "warmup",
      durationType: "time",
      durationValue: 600, // 10 min
      targetType: "open",
    },
    {
      order: 2,
      type: "steady",
      durationType: "distance",
      durationValue: 6000, // 6 km in meters
      targetType: "pace",
      targetMin: 300, // 5:00/km
      targetMax: 315, // 5:15/km
    },
    {
      order: 3,
      type: "cooldown",
      durationType: "time",
      durationValue: 600, // 10 min
      targetType: "open",
    },
  ];

  it("produces warmup, active, cooldown steps", () => {
    const result = formatStepsForGarmin(tempoSteps);
    expect(result).toHaveLength(3);
    expect((result[0] as GarminWorkoutStepDTO).stepType).toBe("WARMUP");
    expect((result[1] as GarminWorkoutStepDTO).stepType).toBe("ACTIVE");
    expect((result[2] as GarminWorkoutStepDTO).stepType).toBe("COOLDOWN");
  });

  it("tempo step uses DISTANCE end condition with meters value", () => {
    const result = formatStepsForGarmin(tempoSteps);
    const tempo = result[1] as GarminWorkoutStepDTO;
    expect(tempo.endCondition).toBe("DISTANCE");
    expect(tempo.endConditionValue).toBe(6000);
  });

  it("tempo step has correct pace target range", () => {
    const result = formatStepsForGarmin(tempoSteps);
    const tempo = result[1] as GarminWorkoutStepDTO;
    expect(tempo.targetType).toBe("PACE");
    expect(tempo.targetValueLow).toBe(300); // 5:00/km
    expect(tempo.targetValueHigh).toBe(315); // 5:15/km
  });
});

// ─── Long Run ───────────────────────────────────────────────────────────────

describe("formatStepsForGarmin — long run", () => {
  const longRunSteps: WorkoutStep[] = [
    {
      order: 1,
      type: "warmup",
      durationType: "time",
      durationValue: 300, // 5 min
      targetType: "open",
    },
    {
      order: 2,
      type: "steady",
      durationType: "distance",
      durationValue: 18000, // 18 km in meters
      targetType: "pace",
      targetMin: 345, // 5:45/km
      targetMax: 390, // 6:30/km
    },
    {
      order: 3,
      type: "cooldown",
      durationType: "time",
      durationValue: 300, // 5 min
      targetType: "open",
    },
  ];

  it("produces 3 steps", () => {
    const result = formatStepsForGarmin(longRunSteps);
    expect(result).toHaveLength(3);
  });

  it("main step distance is 18000 meters", () => {
    const result = formatStepsForGarmin(longRunSteps);
    const main = result[1] as GarminWorkoutStepDTO;
    expect(main.endConditionValue).toBe(18000);
  });

  it("pace targets reflect slower long-run pace", () => {
    const result = formatStepsForGarmin(longRunSteps);
    const main = result[1] as GarminWorkoutStepDTO;
    expect(main.targetValueLow).toBe(345);
    expect(main.targetValueHigh).toBe(390);
  });
});

// ─── Open Target Steps ──────────────────────────────────────────────────────

describe("formatStepsForGarmin — open targets", () => {
  const openSteps: WorkoutStep[] = [
    {
      order: 1,
      type: "warmup",
      durationType: "open",
      targetType: "open",
    },
  ];

  it("omits endConditionValue for OPEN end condition", () => {
    const result = formatStepsForGarmin(openSteps);
    const step = result[0] as GarminWorkoutStepDTO;
    expect(step.endCondition).toBe("OPEN");
    expect(step.endConditionValue).toBeUndefined();
  });

  it("omits target values for OPEN target type", () => {
    const result = formatStepsForGarmin(openSteps);
    const step = result[0] as GarminWorkoutStepDTO;
    expect(step.targetType).toBe("OPEN");
    expect(step.targetValueLow).toBeUndefined();
    expect(step.targetValueHigh).toBeUndefined();
  });
});

// ─── Heart Rate Target ──────────────────────────────────────────────────────

describe("formatStepsForGarmin — heart rate targets", () => {
  const hrSteps: WorkoutStep[] = [
    {
      order: 1,
      type: "steady",
      durationType: "time",
      durationValue: 1800, // 30 min
      targetType: "heart_rate",
      targetMin: 140,
      targetMax: 155,
    },
  ];

  it("maps heart_rate to HEART_RATE target type", () => {
    const result = formatStepsForGarmin(hrSteps);
    const step = result[0] as GarminWorkoutStepDTO;
    expect(step.targetType).toBe("HEART_RATE");
    expect(step.targetValueLow).toBe(140);
    expect(step.targetValueHigh).toBe(155);
  });
});

// ─── Step Ordering ──────────────────────────────────────────────────────────

describe("formatStepsForGarmin — step ordering", () => {
  it("sorts steps by order field before assigning stepOrder", () => {
    const unordered: WorkoutStep[] = [
      {
        order: 3,
        type: "cooldown",
        durationType: "time",
        durationValue: 300,
        targetType: "open",
      },
      {
        order: 1,
        type: "warmup",
        durationType: "time",
        durationValue: 300,
        targetType: "open",
      },
      {
        order: 2,
        type: "steady",
        durationType: "time",
        durationValue: 1200,
        targetType: "open",
      },
    ];

    const result = formatStepsForGarmin(unordered);
    expect((result[0] as GarminWorkoutStepDTO).stepType).toBe("WARMUP");
    expect((result[0] as GarminWorkoutStepDTO).stepOrder).toBe(1);
    expect((result[1] as GarminWorkoutStepDTO).stepType).toBe("ACTIVE");
    expect((result[1] as GarminWorkoutStepDTO).stepOrder).toBe(2);
    expect((result[2] as GarminWorkoutStepDTO).stepType).toBe("COOLDOWN");
    expect((result[2] as GarminWorkoutStepDTO).stepOrder).toBe(3);
  });
});

// ─── buildGarminWorkout ─────────────────────────────────────────────────────

describe("buildGarminWorkout", () => {
  const steps: WorkoutStep[] = [
    {
      order: 1,
      type: "steady",
      durationType: "time",
      durationValue: 2400,
      targetType: "pace",
      targetMin: 330,
      targetMax: 360,
    },
  ];

  it("sets workoutName and sport", () => {
    const dto = buildGarminWorkout(
      "Easy Run - 40min",
      "Keep it easy",
      "easy_run",
      steps,
    );
    expect(dto.workoutName).toBe("Easy Run - 40min");
    expect(dto.sport).toBe("RUNNING");
    expect(dto.description).toBe("Keep it easy");
  });

  it("includes scheduledDate when provided", () => {
    const dto = buildGarminWorkout(
      "Easy Run",
      undefined,
      "easy_run",
      steps,
      "2026-03-15",
    );
    expect(dto.scheduledDate).toBe("2026-03-15");
  });

  it("omits scheduledDate when not provided", () => {
    const dto = buildGarminWorkout("Easy Run", undefined, "easy_run", steps);
    expect(dto.scheduledDate).toBeUndefined();
  });

  it("omits description when undefined", () => {
    const dto = buildGarminWorkout("Easy Run", undefined, "easy_run", steps);
    expect(dto.description).toBeUndefined();
  });

  it("maps recovery to RUNNING sport", () => {
    const dto = buildGarminWorkout("Recovery", undefined, "recovery", steps);
    expect(dto.sport).toBe("RUNNING");
  });

  it("maps cross_training to OTHER sport", () => {
    const dto = buildGarminWorkout(
      "Cross Training",
      undefined,
      "cross_training",
      steps,
    );
    expect(dto.sport).toBe("OTHER");
  });

  it("maps rest to OTHER sport", () => {
    const dto = buildGarminWorkout("Rest Day", undefined, "rest", steps);
    expect(dto.sport).toBe("OTHER");
  });

  it("converts steps correctly in the workout DTO", () => {
    const dto = buildGarminWorkout("Easy Run", undefined, "easy_run", steps);
    expect(dto.steps).toHaveLength(1);
    const step = dto.steps[0] as GarminWorkoutStepDTO;
    expect(step.stepType).toBe("ACTIVE");
    expect(step.targetType).toBe("PACE");
  });
});

// ─── Pace Conversion Precision ──────────────────────────────────────────────

describe("pace conversion precision", () => {
  it("round-trips pace string through conversions without loss", () => {
    const paces = ["3:30", "4:00", "4:30", "5:00", "5:15", "5:30", "6:00", "6:45", "7:00"];
    for (const pace of paces) {
      const seconds = paceStringToSecondsPerKm(pace);
      const result = secondsPerKmToPaceString(seconds);
      expect(result).toBe(pace);
    }
  });

  it("preserves pace targets exactly through Garmin formatting", () => {
    // 4:30/km = 270 sec/km, 4:45/km = 285 sec/km
    const steps: WorkoutStep[] = [
      {
        order: 1,
        type: "steady",
        durationType: "distance",
        durationValue: 5000,
        targetType: "pace",
        targetMin: 270,
        targetMax: 285,
      },
    ];

    const garminSteps = formatStepsForGarmin(steps);
    const step = garminSteps[0] as GarminWorkoutStepDTO;
    expect(step.targetValueLow).toBe(270);
    expect(step.targetValueHigh).toBe(285);
  });
});

// ─── Distance Conversion Precision ──────────────────────────────────────────

describe("distance conversion precision", () => {
  it("preserves meter values exactly through Garmin formatting", () => {
    const steps: WorkoutStep[] = [
      {
        order: 1,
        type: "steady",
        durationType: "distance",
        durationValue: 10000, // 10km in meters
        targetType: "open",
      },
    ];

    const garminSteps = formatStepsForGarmin(steps);
    const step = garminSteps[0] as GarminWorkoutStepDTO;
    expect(step.endConditionValue).toBe(10000);
  });

  it("preserves sub-km distances correctly", () => {
    const steps: WorkoutStep[] = [
      {
        order: 1,
        type: "interval",
        repeatCount: 4,
        workStep: {
          durationType: "distance",
          durationValue: 400, // 400 meters
          targetType: "pace",
          targetMin: 210, // 3:30/km
          targetMax: 225, // 3:45/km
        },
        restStep: {
          durationType: "distance",
          durationValue: 200, // 200m jog
          targetType: "open",
        },
      },
    ];

    const garminSteps = formatStepsForGarmin(steps);
    const group = garminSteps[0] as GarminWorkoutRepeatGroupDTO;
    expect(group.steps[0].endConditionValue).toBe(400);
    expect(group.steps[1].endConditionValue).toBe(200);
  });
});

// ─── Duration Conversion Precision ──────────────────────────────────────────

describe("duration conversion precision", () => {
  it("preserves second values exactly through Garmin formatting", () => {
    const steps: WorkoutStep[] = [
      {
        order: 1,
        type: "warmup",
        durationType: "time",
        durationValue: 600, // 10 min in seconds
        targetType: "open",
      },
    ];

    const garminSteps = formatStepsForGarmin(steps);
    const step = garminSteps[0] as GarminWorkoutStepDTO;
    expect(step.endConditionValue).toBe(600);
  });

  it("handles non-round-minute durations", () => {
    const steps: WorkoutStep[] = [
      {
        order: 1,
        type: "steady",
        durationType: "time",
        durationValue: 1500, // 25 minutes
        targetType: "open",
      },
    ];

    const garminSteps = formatStepsForGarmin(steps);
    const step = garminSteps[0] as GarminWorkoutStepDTO;
    expect(step.endConditionValue).toBe(1500);
  });
});

// ─── Complex Workout: Full Interval Session ─────────────────────────────────

describe("formatStepsForGarmin — complete interval session", () => {
  it("handles a realistic 6x1km interval workout", () => {
    const steps: WorkoutStep[] = [
      {
        order: 1,
        type: "warmup",
        durationType: "time",
        durationValue: 900, // 15 min
        targetType: "open",
        description: "Easy jog warmup with strides",
      },
      {
        order: 2,
        type: "interval",
        repeatCount: 6,
        workStep: {
          durationType: "distance",
          durationValue: 1000, // 1km
          targetType: "pace",
          targetMin: 255, // 4:15/km
          targetMax: 270, // 4:30/km
        },
        restStep: {
          durationType: "time",
          durationValue: 90, // 90 sec recovery
          targetType: "open",
        },
      },
      {
        order: 3,
        type: "cooldown",
        durationType: "time",
        durationValue: 600, // 10 min
        targetType: "open",
        description: "Easy jog cooldown",
      },
    ];

    const result = formatStepsForGarmin(steps);
    expect(result).toHaveLength(3);

    // Warmup
    const warmup = result[0] as GarminWorkoutStepDTO;
    expect(warmup.stepType).toBe("WARMUP");
    expect(warmup.endConditionValue).toBe(900);

    // Repeat group
    const group = result[1] as GarminWorkoutRepeatGroupDTO;
    expect(group.numberOfIterations).toBe(6);

    // Work interval
    const work = group.steps[0];
    expect(work.endCondition).toBe("DISTANCE");
    expect(work.endConditionValue).toBe(1000);
    expect(work.targetValueLow).toBe(255);
    expect(work.targetValueHigh).toBe(270);

    // Rest interval — time-based recovery
    const rest = group.steps[1];
    expect(rest.endCondition).toBe("TIME");
    expect(rest.endConditionValue).toBe(90);
    expect(rest.targetType).toBe("OPEN");

    // Cooldown
    const cooldown = result[2] as GarminWorkoutStepDTO;
    expect(cooldown.stepType).toBe("COOLDOWN");
    expect(cooldown.endConditionValue).toBe(600);
  });
});
