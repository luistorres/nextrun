import { describe, it, expect } from "vitest";
import { findUpdatedWorkout, dayOfWeekFromDate } from "../adaptation-applier";
import type { AdaptationChange, GeneratedWorkout } from "@/types/plan";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChange(overrides: Partial<AdaptationChange> = {}): AdaptationChange {
  return {
    workoutId: "workout-1",
    change: "modified",
    from: "Old title",
    to: "New title",
    reason: "Test reason",
    ...overrides,
  };
}

function makeGeneratedWorkout(overrides: Partial<GeneratedWorkout> = {}): GeneratedWorkout {
  return {
    day: "2026-03-28",
    type: "easy_run",
    title: "Easy Recovery Run",
    description: "A gentle recovery run",
    targetDistanceMeters: 5000,
    steps: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// findUpdatedWorkout
// ---------------------------------------------------------------------------

describe("findUpdatedWorkout", () => {
  it("returns undefined when updatedWorkouts is undefined", () => {
    const change = makeChange({ to: "Some title" });
    expect(findUpdatedWorkout(change, undefined)).toBeUndefined();
  });

  it("returns undefined when updatedWorkouts is empty", () => {
    const change = makeChange({ to: "Some title" });
    expect(findUpdatedWorkout(change, [])).toBeUndefined();
  });

  it("matches by change.to field (case-insensitive)", () => {
    const workout = makeGeneratedWorkout({ title: "Easy Recovery Run" });
    const change = makeChange({ to: "easy recovery run" });
    expect(findUpdatedWorkout(change, [workout])).toBe(workout);
  });

  it("matches by change.to field with extra whitespace", () => {
    const workout = makeGeneratedWorkout({ title: "Easy Recovery Run" });
    const change = makeChange({ to: "  Easy Recovery Run  " });
    expect(findUpdatedWorkout(change, [workout])).toBe(workout);
  });

  it("falls back to matching workoutId against title when to does not match", () => {
    const workout = makeGeneratedWorkout({ title: "recovery-workout" });
    const change = makeChange({
      workoutId: "recovery-workout",
      to: "no-match",
    });
    expect(findUpdatedWorkout(change, [workout])).toBe(workout);
  });

  it("returns first match when multiple workouts have the same title", () => {
    const first = makeGeneratedWorkout({ title: "Easy Run", day: "2026-03-28" });
    const second = makeGeneratedWorkout({ title: "Easy Run", day: "2026-03-29" });
    const change = makeChange({ to: "Easy Run" });
    expect(findUpdatedWorkout(change, [first, second])).toBe(first);
  });

  it("returns undefined when nothing matches", () => {
    const workout = makeGeneratedWorkout({ title: "Tempo Run" });
    const change = makeChange({ workoutId: "workout-1", to: "Hill Repeats" });
    expect(findUpdatedWorkout(change, [workout])).toBeUndefined();
  });

  it("matches when change.to is undefined but workoutId matches title", () => {
    const workout = makeGeneratedWorkout({ title: "tempo-session" });
    const change = makeChange({ workoutId: "Tempo-Session", to: undefined });
    expect(findUpdatedWorkout(change, [workout])).toBe(workout);
  });
});

// ---------------------------------------------------------------------------
// dayOfWeekFromDate
// ---------------------------------------------------------------------------

describe("dayOfWeekFromDate", () => {
  it("returns lowercase day name for a Monday", () => {
    // 2026-03-23 is a Monday
    expect(dayOfWeekFromDate("2026-03-23")).toBe("monday");
  });

  it("returns lowercase day name for a Saturday", () => {
    // 2026-03-28 is a Saturday
    expect(dayOfWeekFromDate("2026-03-28")).toBe("saturday");
  });

  it("returns lowercase day name for a Sunday", () => {
    // 2026-03-29 is a Sunday
    expect(dayOfWeekFromDate("2026-03-29")).toBe("sunday");
  });

  it("returns lowercase day name for a Wednesday", () => {
    // 2026-03-25 is a Wednesday
    expect(dayOfWeekFromDate("2026-03-25")).toBe("wednesday");
  });
});
