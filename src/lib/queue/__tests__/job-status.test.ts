import { describe, it, expect } from "vitest";
import { mapJobState } from "../job-status";

describe("mapJobState", () => {
  it.each([
    ["waiting", "queued"],
    ["delayed", "queued"],
    ["prioritized", "queued"],
    ["waiting-children", "queued"],
    ["active", "running"],
    ["completed", "completed"],
    ["failed", "failed"],
    ["unknown", "queued"],
  ])("maps %s to %s", (input, expected) => {
    expect(mapJobState(input)).toBe(expected);
  });
});
