import { describe, expect, it } from "vitest";
import { weeksUntilRace } from "@/lib/plan-engine/periodization";

describe("weeksUntilRace", () => {
  it("counts the race week when the race is later in its week than today", () => {
    expect(weeksUntilRace("2026-10-11", new Date(2026, 7, 17, 15, 36))).toBe(8);
  });

  it("puts a race in the current week in week 1", () => {
    expect(weeksUntilRace("2026-09-27", new Date(2026, 8, 26, 9))).toBe(1);
  });

  it("does not depend on the time of day", () => {
    const morning = weeksUntilRace("2026-10-11", new Date(2026, 8, 26, 0, 1));
    const night = weeksUntilRace("2026-10-11", new Date(2026, 8, 26, 23, 59));
    expect(morning).toBe(3);
    expect(night).toBe(3);
  });
});
