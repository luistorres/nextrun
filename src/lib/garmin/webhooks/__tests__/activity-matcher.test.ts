import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before importing the module under test
vi.mock("@/lib/db/queries/training", () => ({
  getActivePlanWithWorkouts: vi.fn(),
  updateWorkoutStatus: vi.fn(),
}));

vi.mock("@/lib/db/queries/activities", () => ({
  linkActivityToWorkout: vi.fn(),
}));

import { matchActivityToWorkout } from "../activity-matcher";
import { getActivePlanWithWorkouts, updateWorkoutStatus } from "@/lib/db/queries/training";
import { linkActivityToWorkout } from "@/lib/db/queries/activities";

const mockGetPlan = vi.mocked(getActivePlanWithWorkouts);
const mockUpdateStatus = vi.mocked(updateWorkoutStatus);
const mockLink = vi.mocked(linkActivityToWorkout);

function makePlan(workouts: Array<{
  id: string;
  scheduledDate: string;
  workoutType: string;
  completionStatus: string;
}>) {
  // Cast to satisfy Drizzle's full return type — only the fields the matcher
  // actually reads are relevant in these tests.
  return { id: "plan-1", workouts } as NonNullable<Awaited<ReturnType<typeof getActivePlanWithWorkouts>>>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("matchActivityToWorkout", () => {
  it("returns unmatched when no active plan exists", async () => {
    mockGetPlan.mockResolvedValue(null);
    const result = await matchActivityToWorkout(
      "user-1", "act-1", "run", new Date("2026-02-25T10:00:00Z"),
    );
    expect(result).toEqual({ matched: false });
  });

  it("primary match: links first activity to pending workout", async () => {
    mockGetPlan.mockResolvedValue(makePlan([
      { id: "w-1", scheduledDate: "2026-02-25", workoutType: "easy_run", completionStatus: "pending" },
    ]));
    mockLink.mockResolvedValue(undefined as never);
    mockUpdateStatus.mockResolvedValue(undefined as never);

    const result = await matchActivityToWorkout(
      "user-1", "act-1", "run", new Date("2026-02-25T10:00:00Z"),
    );

    expect(result).toEqual({
      matched: true,
      plannedWorkoutId: "w-1",
      planId: "plan-1",
    });
    expect(mockLink).toHaveBeenCalledWith("act-1", "w-1");
    expect(mockUpdateStatus).toHaveBeenCalledWith("w-1", "completed", "act-1");
  });

  it("secondary match: links additional activity to already-completed workout", async () => {
    mockGetPlan.mockResolvedValue(makePlan([
      { id: "w-1", scheduledDate: "2026-02-25", workoutType: "easy_run", completionStatus: "completed" },
    ]));
    mockLink.mockResolvedValue(undefined as never);

    const result = await matchActivityToWorkout(
      "user-1", "act-2", "run", new Date("2026-02-25T15:00:00Z"),
    );

    expect(result).toEqual({
      matched: true,
      plannedWorkoutId: "w-1",
      planId: "plan-1",
    });
    expect(mockLink).toHaveBeenCalledWith("act-2", "w-1");
    // Should NOT update workout status (already completed)
    expect(mockUpdateStatus).not.toHaveBeenCalled();
  });

  it("does not match incompatible activity type", async () => {
    mockGetPlan.mockResolvedValue(makePlan([
      { id: "w-1", scheduledDate: "2026-02-25", workoutType: "easy_run", completionStatus: "pending" },
    ]));

    const result = await matchActivityToWorkout(
      "user-1", "act-1", "strength", new Date("2026-02-25T10:00:00Z"),
    );

    expect(result).toEqual({ matched: false });
    expect(mockLink).not.toHaveBeenCalled();
  });

  it("returns unmatched on a rest day with no planned workout", async () => {
    mockGetPlan.mockResolvedValue(makePlan([
      { id: "w-1", scheduledDate: "2026-02-26", workoutType: "easy_run", completionStatus: "pending" },
    ]));

    const result = await matchActivityToWorkout(
      "user-1", "act-1", "run", new Date("2026-02-25T10:00:00Z"),
    );

    expect(result).toEqual({ matched: false });
  });

  it("prefers pending workout over completed when both exist on same date", async () => {
    mockGetPlan.mockResolvedValue(makePlan([
      { id: "w-completed", scheduledDate: "2026-02-25", workoutType: "easy_run", completionStatus: "completed" },
      { id: "w-pending", scheduledDate: "2026-02-25", workoutType: "tempo", completionStatus: "pending" },
    ]));
    mockLink.mockResolvedValue(undefined as never);
    mockUpdateStatus.mockResolvedValue(undefined as never);

    const result = await matchActivityToWorkout(
      "user-1", "act-1", "run", new Date("2026-02-25T10:00:00Z"),
    );

    // Should match the pending workout first (Phase 1)
    expect(result.plannedWorkoutId).toBe("w-pending");
    expect(mockUpdateStatus).toHaveBeenCalledWith("w-pending", "completed", "act-1");
  });
});
