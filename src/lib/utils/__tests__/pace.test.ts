import { describe, it, expect } from "vitest";
import {
  secPerKmToDisplay,
  displayToSecPerKm,
  mpsToSecPerKm,
  secPerKmToMps,
  secPerKmToSecPerM,
  secPerMToSecPerKm,
  formatDistance,
  formatDuration,
} from "../pace";

describe("pace utilities", () => {
  describe("secPerKmToDisplay", () => {
    it("converts 300 sec/km to 5:00", () => {
      expect(secPerKmToDisplay(300)).toBe("5:00");
    });

    it("converts 270 sec/km to 4:30", () => {
      expect(secPerKmToDisplay(270)).toBe("4:30");
    });

    it("converts 345 sec/km to 5:45", () => {
      expect(secPerKmToDisplay(345)).toBe("5:45");
    });
  });

  describe("displayToSecPerKm", () => {
    it("converts 5:00 to 300", () => {
      expect(displayToSecPerKm("5:00")).toBe(300);
    });

    it("converts 4:30 to 270", () => {
      expect(displayToSecPerKm("4:30")).toBe(270);
    });
  });

  describe("speed/pace conversions", () => {
    it("converts m/s to sec/km and back", () => {
      const mps = 3.33; // ~5:00/km
      const secPerKm = mpsToSecPerKm(mps);
      expect(secPerKm).toBeCloseTo(300.3, 0);
      expect(secPerKmToMps(secPerKm)).toBeCloseTo(mps, 2);
    });

    it("handles zero speed", () => {
      expect(mpsToSecPerKm(0)).toBe(0);
      expect(secPerKmToMps(0)).toBe(0);
    });
  });

  describe("sec/km to sec/m", () => {
    it("converts 300 sec/km to 0.3 sec/m", () => {
      expect(secPerKmToSecPerM(300)).toBeCloseTo(0.3);
    });

    it("converts back", () => {
      expect(secPerMToSecPerKm(0.3)).toBeCloseTo(300);
    });
  });

  describe("formatDistance", () => {
    it("formats meters", () => {
      expect(formatDistance(800)).toBe("800m");
    });

    it("formats exact km", () => {
      expect(formatDistance(5000)).toBe("5km");
    });

    it("formats fractional km", () => {
      expect(formatDistance(2500)).toBe("2.5km");
    });
  });

  describe("formatDuration", () => {
    it("formats minutes and seconds", () => {
      expect(formatDuration(300)).toBe("5:00");
    });

    it("formats hours, minutes, and seconds", () => {
      expect(formatDuration(3661)).toBe("1:01:01");
    });

    it("pads seconds", () => {
      expect(formatDuration(65)).toBe("1:05");
    });
  });
});
