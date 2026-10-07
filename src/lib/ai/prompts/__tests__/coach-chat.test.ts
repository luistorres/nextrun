import { describe, it, expect } from "vitest";
import { formatCoachContext, type CoachContext } from "../coach-chat";

describe("formatCoachContext", () => {
  const baseContext: CoachContext = {
    plan: null,
    upcomingWorkouts: [],
    recentActivities: [],
    healthSnapshot: null,
    trainingLoadSummary: null,
  };

  it("shows no active plan when plan is null", () => {
    const result = formatCoachContext(baseContext);
    expect(result).toContain("No active training plan.");
  });

  it("includes plan phase and week info", () => {
    const ctx: CoachContext = {
      ...baseContext,
      plan: {
        phase: "build",
        currentWeek: 4,
        totalWeeks: 12,
        weeklyMileageTargetKm: "35.0",
        goalType: "half_marathon",
        raceName: "City Half Marathon",
        raceDate: "2026-06-15",
      },
    };
    const result = formatCoachContext(ctx);
    expect(result).toContain("Phase: build");
    expect(result).toContain("Week 4/12");
    expect(result).toContain("35.0km/week");
    expect(result).toContain("half_marathon");
    expect(result).toContain("City Half Marathon");
    expect(result).toContain("2026-06-15");
  });

  it("includes upcoming workouts", () => {
    const ctx: CoachContext = {
      ...baseContext,
      upcomingWorkouts: [
        {
          scheduledDate: "2026-03-27",
          workoutType: "easy_run",
          title: "Easy 5K",
          description: "Conversational pace",
          targetDistanceMeters: 5000,
        },
        {
          scheduledDate: "2026-03-29",
          workoutType: "tempo",
          title: "Tempo 8K",
          description: null,
          targetDistanceMeters: 8000,
        },
      ],
    };
    const result = formatCoachContext(ctx);
    expect(result).toContain("Upcoming Workouts");
    expect(result).toContain("Easy 5K");
    expect(result).toContain("5.0km");
    expect(result).toContain("Tempo 8K");
    expect(result).toContain("8.0km");
  });

  it("includes health snapshot metrics", () => {
    const ctx: CoachContext = {
      ...baseContext,
      healthSnapshot: {
        hrv: 52,
        sleepScore: 78,
        stress: 32,
        bodyBattery: 65,
        restingHR: 55,
      },
    };
    const result = formatCoachContext(ctx);
    expect(result).toContain("HRV: 52ms");
    expect(result).toContain("Sleep: 78");
    expect(result).toContain("Stress: 32");
    expect(result).toContain("Body Battery: 65");
    expect(result).toContain("RHR: 55bpm");
  });

  it("skips health section when all metrics are null", () => {
    const ctx: CoachContext = {
      ...baseContext,
      healthSnapshot: {
        hrv: null,
        sleepScore: null,
        stress: null,
        bodyBattery: null,
        restingHR: null,
      },
    };
    const result = formatCoachContext(ctx);
    expect(result).not.toContain("Latest Health Metrics");
  });

  it("includes recent activities", () => {
    const ctx: CoachContext = {
      ...baseContext,
      recentActivities: [
        { date: "2026-03-25", type: "running", distanceKm: 8.5, durationMin: 48 },
        { date: "2026-03-24", type: "running", distanceKm: 5.0, durationMin: 30 },
      ],
    };
    const result = formatCoachContext(ctx);
    expect(result).toContain("Recent Activities");
    expect(result).toContain("8.5km");
    expect(result).toContain("48min");
  });

  it("includes training load summary", () => {
    const ctx: CoachContext = {
      ...baseContext,
      trainingLoadSummary: "5 activities in last 7 days: 32.5km, 195min total",
    };
    const result = formatCoachContext(ctx);
    expect(result).toContain("Training Load");
    expect(result).toContain("32.5km");
  });

  it("limits recent activities to 5", () => {
    const ctx: CoachContext = {
      ...baseContext,
      recentActivities: Array.from({ length: 8 }, (_, i) => ({
        date: `2026-03-${20 + i}`,
        type: "running",
        distanceKm: 5.0,
        durationMin: 30,
      })),
    };
    const result = formatCoachContext(ctx);
    const activityLines = result
      .split("\n")
      .filter((l) => l.startsWith("- 2026-03-"));
    expect(activityLines.length).toBe(5);
  });
});
