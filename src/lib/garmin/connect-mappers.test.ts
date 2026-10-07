import { describe, it, expect } from "vitest";
import {
  toFiniteNumber,
  toNumericString,
  toIntOrNull,
  verticalOscillationToMm,
  strideLengthToMeters,
  extractRunningDynamics,
  parseGmtToEpochSeconds,
  mapSplitLaps,
} from "./connect-mappers";

// ─── Generic Parsers ────────────────────────────────────────────────────────

describe("toFiniteNumber", () => {
  it("parses numbers and numeric strings", () => {
    expect(toFiniteNumber(42)).toBe(42);
    expect(toFiniteNumber("3.5")).toBe(3.5);
    expect(toFiniteNumber(0)).toBe(0);
  });

  it("rejects null, undefined, empty string, NaN, Infinity and garbage", () => {
    expect(toFiniteNumber(null)).toBeNull();
    expect(toFiniteNumber(undefined)).toBeNull();
    expect(toFiniteNumber("")).toBeNull();
    expect(toFiniteNumber(NaN)).toBeNull();
    expect(toFiniteNumber(Infinity)).toBeNull();
    expect(toFiniteNumber("abc")).toBeNull();
    expect(toFiniteNumber({})).toBeNull();
  });
});

describe("toNumericString / toIntOrNull", () => {
  it("formats finite numbers, nulls everything else", () => {
    expect(toNumericString(87.3)).toBe("87.3");
    expect(toNumericString("not a number")).toBeNull();
    expect(toIntOrNull(171.6)).toBe(172);
    expect(toIntOrNull(undefined)).toBeNull();
  });
});

// ─── Unit Conversions ───────────────────────────────────────────────────────

describe("verticalOscillationToMm", () => {
  it("converts cm-magnitude values to mm (×10)", () => {
    expect(verticalOscillationToMm(9.2)).toBeCloseTo(92);
    expect(verticalOscillationToMm(6.5)).toBeCloseTo(65);
  });

  it("passes through mm-magnitude values unchanged", () => {
    expect(verticalOscillationToMm(92)).toBe(92);
    expect(verticalOscillationToMm(130)).toBe(130);
  });

  it("rejects zero, negative and non-numeric values", () => {
    expect(verticalOscillationToMm(0)).toBeNull();
    expect(verticalOscillationToMm(-5)).toBeNull();
    expect(verticalOscillationToMm("garbage")).toBeNull();
    expect(verticalOscillationToMm(undefined)).toBeNull();
  });
});

describe("strideLengthToMeters", () => {
  it("converts cm-magnitude values to meters (÷100)", () => {
    expect(strideLengthToMeters(112.4)).toBeCloseTo(1.124);
    expect(strideLengthToMeters(95)).toBeCloseTo(0.95);
  });

  it("passes through meter-magnitude values unchanged", () => {
    expect(strideLengthToMeters(1.12)).toBeCloseTo(1.12);
    expect(strideLengthToMeters(0.95)).toBeCloseTo(0.95);
  });

  it("rejects zero, negative and non-numeric values", () => {
    expect(strideLengthToMeters(0)).toBeNull();
    expect(strideLengthToMeters(-1)).toBeNull();
    expect(strideLengthToMeters(null)).toBeNull();
  });
});

// ─── Running Dynamics Extraction ────────────────────────────────────────────

describe("extractRunningDynamics", () => {
  it("maps a list-payload (IActivity) shape with unit conversions", () => {
    const dynamics = extractRunningDynamics({
      averageRunningCadenceInStepsPerMinute: 171.2,
      maxRunningCadenceInStepsPerMinute: 188,
      avgGroundContactTime: 244.5,
      avgVerticalOscillation: 9.2, // cm → 92 mm
      avgVerticalRatio: 8.1,
      avgStrideLength: 112.4, // cm → 1.124 m
      activityTrainingLoad: 187.3,
      lactateThresholdBpm: 168.4,
      lactateThresholdSpeed: 3.42,
    });

    expect(dynamics).toEqual({
      avgRunCadence: "171.2",
      maxRunCadence: "188",
      activityTrainingLoad: "187.3",
      avgGroundContactTimeMs: "244.5",
      avgVerticalOscillationMm: "92",
      avgVerticalRatioPct: "8.1",
      avgStrideLengthM: "1.124",
      lactateThresholdHeartRate: 168,
      lactateThresholdPaceMps: "3.42",
    });
  });

  it("accepts the detail-payload (summaryDTO) spellings", () => {
    const dynamics = extractRunningDynamics({
      averageRunCadence: 168,
      maxRunCadence: 182,
      groundContactTime: 251,
      verticalOscillation: 8.8,
      verticalRatio: 7.9,
      strideLength: 104,
    });

    expect(dynamics.avgRunCadence).toBe("168");
    expect(dynamics.maxRunCadence).toBe("182");
    expect(dynamics.avgGroundContactTimeMs).toBe("251");
    expect(dynamics.avgVerticalOscillationMm).toBe("88");
    expect(dynamics.avgVerticalRatioPct).toBe("7.9");
    expect(dynamics.avgStrideLengthM).toBe("1.04");
  });

  it("prefers the list-payload spelling when both are present", () => {
    const dynamics = extractRunningDynamics({
      averageRunningCadenceInStepsPerMinute: 171,
      averageRunCadence: 999,
    });
    expect(dynamics.avgRunCadence).toBe("171");
  });

  it("returns all-null for an empty or garbage payload", () => {
    const empty = extractRunningDynamics({});
    expect(Object.values(empty).every((v) => v === null)).toBe(true);

    const garbage = extractRunningDynamics({
      averageRunningCadenceInStepsPerMinute: "n/a",
      avgVerticalOscillation: {},
      avgStrideLength: null,
      activityTrainingLoad: NaN,
      lactateThresholdBpm: 0, // 0 bpm is not a real threshold
      lactateThresholdSpeed: -1,
    });
    expect(Object.values(garbage).every((v) => v === null)).toBe(true);
  });
});

// ─── GMT Timestamp Parsing ──────────────────────────────────────────────────

describe("parseGmtToEpochSeconds", () => {
  it("parses Connect's space-separated GMT format as UTC", () => {
    expect(parseGmtToEpochSeconds("1970-01-01 00:00:10")).toBe(10);
    expect(parseGmtToEpochSeconds("2026-06-08 09:00:00.0")).toBe(
      Date.UTC(2026, 5, 8, 9, 0, 0) / 1000,
    );
  });

  it("parses ISO format and keeps explicit timezone designators", () => {
    expect(parseGmtToEpochSeconds("1970-01-01T00:01:00Z")).toBe(60);
    expect(parseGmtToEpochSeconds("1970-01-01T01:00:00+01:00")).toBe(0);
  });

  it("rejects non-strings and unparseable strings", () => {
    expect(parseGmtToEpochSeconds(12345)).toBeNull();
    expect(parseGmtToEpochSeconds("")).toBeNull();
    expect(parseGmtToEpochSeconds("not a date")).toBeNull();
    expect(parseGmtToEpochSeconds(null)).toBeNull();
  });
});

// ─── Splits → Laps ──────────────────────────────────────────────────────────

describe("mapSplitLaps", () => {
  const lapDTO = {
    lapIndex: 1, // Connect is 1-based — we use array position instead
    startTimeGMT: "1970-01-01 00:00:10",
    distance: 1000.0,
    duration: 295.4,
    elapsedDuration: 300.1,
    averageSpeed: 3.387,
    averageHR: 152.0,
    maxHR: 161.0,
    averageRunCadence: 170.5,
    elevationGain: 12.0,
  };

  it("maps a well-formed lapDTOs payload", () => {
    const laps = mapSplitLaps({ activityId: 123, lapDTOs: [lapDTO] });
    expect(laps).toEqual([
      {
        lapIndex: 0,
        startTimeInSeconds: 10,
        totalDistanceMeters: "1000",
        totalTimerTimeSeconds: "295.4",
        avgSpeedMps: "3.387",
        avgHeartRate: 152,
        maxHeartRate: 161,
        avgRunCadence: "170.5",
        avgPaceSecondsPerKm: "295.2", // 1000 / 3.387 rounded to 0.1
        totalAscentMeters: "12",
      },
    ]);
  });

  it("uses array position for lapIndex (0-based, FIT-path consistent)", () => {
    const laps = mapSplitLaps({
      lapDTOs: [
        { ...lapDTO, lapIndex: 1 },
        { ...lapDTO, lapIndex: 2 },
      ],
    });
    expect(laps?.map((l) => l.lapIndex)).toEqual([0, 1]);
  });

  it("nulls missing fields and skips non-object entries", () => {
    const laps = mapSplitLaps({ lapDTOs: [{}, null, "garbage"] });
    expect(laps).toHaveLength(1);
    expect(laps![0]).toEqual({
      lapIndex: 0,
      startTimeInSeconds: null,
      totalDistanceMeters: null,
      totalTimerTimeSeconds: null,
      avgSpeedMps: null,
      avgHeartRate: null,
      maxHeartRate: null,
      avgRunCadence: null,
      avgPaceSecondsPerKm: null,
      totalAscentMeters: null,
    });
  });

  it("nulls pace and speed when averageSpeed is zero (treadmill idle lap)", () => {
    const laps = mapSplitLaps({ lapDTOs: [{ ...lapDTO, averageSpeed: 0 }] });
    expect(laps![0].avgSpeedMps).toBeNull();
    expect(laps![0].avgPaceSecondsPerKm).toBeNull();
  });

  it("returns null for unexpected payload shapes", () => {
    expect(mapSplitLaps(null)).toBeNull();
    expect(mapSplitLaps(undefined)).toBeNull();
    expect(mapSplitLaps("error")).toBeNull();
    expect(mapSplitLaps({})).toBeNull();
    expect(mapSplitLaps({ lapDTOs: "nope" })).toBeNull();
  });

  it("returns an empty array for zero laps (valid, nothing to insert)", () => {
    expect(mapSplitLaps({ lapDTOs: [] })).toEqual([]);
  });
});
