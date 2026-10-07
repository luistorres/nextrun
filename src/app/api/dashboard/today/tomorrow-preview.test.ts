import { describe, expect, it } from "vitest";
import { buildTomorrowPreview } from "./tomorrow-preview";

type Workouts = Parameters<typeof buildTomorrowPreview>[0];

function row(partial: Partial<Workouts[number]>): Workouts[number] {
  return {
    id: "wk",
    workoutType: "easy",
    title: "Easy Run",
    description: null,
    targetDistanceMeters: null,
    targetDurationSeconds: null,
    targetPaceMinPerKm: null,
    completionStatus: "pending",
    ...partial,
  } as Workouts[number];
}

describe("buildTomorrowPreview", () => {
  // Ana's bug: today Tue 18, tomorrow Wed 19 is Rest, Thu 20 is a real run.
  // Old code skipped Wed and surfaced Thu's run under the "Tomorrow:" label.
  it("shows tomorrow's rest day, not the next workout further out", () => {
    const workouts = [
      row({ id: "wed", scheduledDate: "2026-08-19", workoutType: "rest", title: "Rest" }),
      row({
        id: "thu",
        scheduledDate: "2026-08-20",
        workoutType: "easy",
        title: "Easy Run + Cadence Cue",
        targetDistanceMeters: 4000,
      }),
    ];

    const preview = buildTomorrowPreview(workouts, "2026-08-18");

    expect(preview?.id).toBe("wed");
    expect(preview?.title).toBe("Rest");
    expect(preview?.scheduledDate).toBe("2026-08-19");
  });

  it("shows tomorrow's workout when tomorrow is a real session", () => {
    const workouts = [
      row({ id: "wed", scheduledDate: "2026-08-19", workoutType: "tempo", title: "Tempo" }),
    ];

    expect(buildTomorrowPreview(workouts, "2026-08-18")?.id).toBe("wed");
  });

  it("prefers the non-rest session when a day has both", () => {
    const workouts = [
      row({ id: "rest", scheduledDate: "2026-08-19", workoutType: "rest", title: "Rest" }),
      row({ id: "run", scheduledDate: "2026-08-19", workoutType: "easy", title: "Easy Run" }),
    ];

    expect(buildTomorrowPreview(workouts, "2026-08-18")?.id).toBe("run");
  });

  it("returns null when nothing is scheduled tomorrow", () => {
    const workouts = [
      row({ id: "sat", scheduledDate: "2026-08-22", workoutType: "long", title: "Long Run" }),
    ];

    expect(buildTomorrowPreview(workouts, "2026-08-18")).toBeNull();
  });
});
