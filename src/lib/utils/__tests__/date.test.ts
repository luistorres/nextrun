import { describe, it, expect } from "vitest";
import {
  toISODate,
  toDisplayDate,
  getWeekStart,
  getWeekDates,
  weeksBetween,
  daysBetween,
  safeParse,
  getDayName,
} from "../date";

describe("date utilities", () => {
  describe("toISODate", () => {
    it("formats date as YYYY-MM-DD", () => {
      expect(toISODate(new Date(2026, 2, 15))).toBe("2026-03-15");
    });
  });

  describe("toDisplayDate", () => {
    it("formats date as 'EEE, MMM d'", () => {
      const result = toDisplayDate(new Date(2026, 2, 15));
      expect(result).toBe("Sun, Mar 15");
    });
  });

  describe("getWeekStart", () => {
    it("returns Monday for a Wednesday", () => {
      const wed = new Date(2026, 1, 11); // Feb 11, 2026 is a Wednesday
      const monday = getWeekStart(wed);
      expect(monday.getDay()).toBe(1); // Monday
    });
  });

  describe("getWeekDates", () => {
    it("returns 7 dates starting from the given date", () => {
      const monday = new Date(2026, 1, 9);
      const dates = getWeekDates(monday);
      expect(dates).toHaveLength(7);
    });
  });

  describe("weeksBetween", () => {
    it("calculates weeks between two dates", () => {
      const start = new Date(2026, 0, 1);
      const end = new Date(2026, 2, 26); // 12 weeks later
      expect(weeksBetween(start, end)).toBe(12);
    });
  });

  describe("daysBetween", () => {
    it("calculates days between two dates", () => {
      const start = new Date(2026, 0, 1);
      const end = new Date(2026, 0, 8);
      expect(daysBetween(start, end)).toBe(7);
    });
  });

  describe("safeParse", () => {
    it("parses valid ISO date string", () => {
      const result = safeParse("2026-03-15");
      expect(result).not.toBeNull();
      expect(result!.getFullYear()).toBe(2026);
    });

    it("returns null for invalid date", () => {
      expect(safeParse("not-a-date")).toBeNull();
    });
  });

  describe("getDayName", () => {
    it("returns correct day name", () => {
      const wed = new Date(2026, 1, 11); // Wednesday
      expect(getDayName(wed)).toBe("wed");
    });
  });
});
