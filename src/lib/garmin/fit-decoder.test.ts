import { describe, it, expect } from "vitest";
import {
  Encoder,
  Profile,
  type Encodable,
  type FileIdMesg,
  type LapMesg,
  type SessionMesg,
  type ZonesTargetMesg,
} from "@garmin/fitsdk";
import {
  extractFitMetrics,
  decodeFitBuffer,
  type DecodedFitMessages,
} from "./fit-decoder";

// ---------------------------------------------------------------------------
// extractFitMetrics — pure extraction over mocked decoded-message objects
// ---------------------------------------------------------------------------

describe("extractFitMetrics", () => {
  it("returns empty metrics for empty / missing message sets", () => {
    expect(extractFitMetrics({})).toEqual({
      laps: [],
      dynamics: {},
      lactateThreshold: {},
    });
  });

  it("never throws on garbage input shapes", () => {
    const garbage: DecodedFitMessages = {
      sessionMesgs: "not-an-array",
      lapMesgs: [null, 42, "lap", { totalDistance: "NaN-ish" }],
      zonesTargetMesgs: { thresholdHeartRate: 170 },
    };
    const result = extractFitMetrics(garbage);
    // Only the one object-shaped lap survives filtering; its non-numeric
    // fields are dropped.
    expect(result.laps).toHaveLength(1);
    expect(result.laps[0]).toMatchObject({ lapIndex: 0 });
    expect(result.laps[0].totalDistanceMeters).toBeUndefined();
    expect(result.dynamics).toEqual({});
    expect(result.lactateThreshold).toEqual({});
  });

  it("extracts laps from camelCase fitsdk messages with derived pace and doubled cadence", () => {
    const messages: DecodedFitMessages = {
      lapMesgs: [
        {
          messageIndex: 0,
          startTime: new Date("2026-06-01T08:00:00Z"),
          totalDistance: 1000,
          totalTimerTime: 300,
          enhancedAvgSpeed: 3.2,
          avgSpeed: 3.1, // enhanced wins
          avgHeartRate: 152,
          maxHeartRate: 161,
          avgRunningCadence: 86,
          avgFractionalCadence: 0.5,
          totalAscent: 12,
        },
        {
          messageIndex: 1,
          totalDistance: 400,
          totalTimerTime: 90,
          avgSpeed: 4.5, // no enhanced — falls back
          avgCadence: 90, // no avgRunningCadence — falls back
        },
      ],
    };

    const { laps } = extractFitMetrics(messages);
    expect(laps).toHaveLength(2);

    expect(laps[0]).toMatchObject({
      lapIndex: 0,
      startTimeInSeconds: Math.floor(
        new Date("2026-06-01T08:00:00Z").getTime() / 1000,
      ),
      totalDistanceMeters: 1000,
      totalTimerTimeSeconds: 300,
      avgSpeedMps: 3.2,
      avgHeartRate: 152,
      maxHeartRate: 161,
      avgRunCadence: (86 + 0.5) * 2, // strides/min one foot → steps/min
      totalAscentMeters: 12,
    });
    expect(laps[0].avgPaceSecondsPerKm).toBeCloseTo(1000 / 3.2, 5);

    expect(laps[1].avgSpeedMps).toBe(4.5);
    expect(laps[1].avgRunCadence).toBe(180); // 90 × 2, no fractional
    expect(laps[1].avgPaceSecondsPerKm).toBeCloseTo(1000 / 4.5, 5);
  });

  it("accepts snake_case keys (raw FIT profile names)", () => {
    const messages: DecodedFitMessages = {
      session_mesgs: [
        {
          avg_stance_time: 245.5,
          avg_vertical_oscillation: 87.3,
          avg_vertical_ratio: 8.2,
          avg_step_length: 1085, // mm
        },
      ],
      lap_mesgs: [
        {
          message_index: 0,
          total_distance: 5000,
          total_timer_time: 1500,
          avg_speed: 3.333,
          avg_heart_rate: 148,
        },
      ],
      zones_target_mesgs: [{ threshold_heart_rate: 171 }],
    };

    const result = extractFitMetrics(messages);
    expect(result.dynamics).toEqual({
      avgGroundContactTimeMs: 245.5,
      avgVerticalOscillationMm: 87.3,
      avgVerticalRatioPct: 8.2,
      avgStrideLengthM: 1.085, // mm → m
    });
    expect(result.laps[0]).toMatchObject({
      lapIndex: 0,
      totalDistanceMeters: 5000,
      avgHeartRate: 148,
    });
    expect(result.lactateThreshold.heartRateBpm).toBe(171);
  });

  it("extracts session running dynamics with unit conversions", () => {
    const messages: DecodedFitMessages = {
      sessionMesgs: [
        {
          avgStanceTime: 238.1, // already ms
          avgVerticalOscillation: 92.4, // mm
          avgVerticalRatio: 7.9, // %
          avgStepLength: 1240, // mm → 1.24 m
        },
      ],
    };

    expect(extractFitMetrics(messages).dynamics).toEqual({
      avgGroundContactTimeMs: 238.1,
      avgVerticalOscillationMm: 92.4,
      avgVerticalRatioPct: 7.9,
      avgStrideLengthM: 1.24,
    });
  });

  it("handles partially populated sessions (every dynamics field optional)", () => {
    const messages: DecodedFitMessages = {
      sessionMesgs: [{ avgStanceTime: 250 }],
    };
    const { dynamics } = extractFitMetrics(messages);
    expect(dynamics.avgGroundContactTimeMs).toBe(250);
    expect(dynamics.avgVerticalOscillationMm).toBeUndefined();
    expect(dynamics.avgVerticalRatioPct).toBeUndefined();
    expect(dynamics.avgStrideLengthM).toBeUndefined();
  });

  it("prefers session lactate threshold fields over zones_target", () => {
    const messages: DecodedFitMessages = {
      sessionMesgs: [
        { lactateThresholdHeartRate: 168, lactateThresholdSpeed: 3.61 },
      ],
      zonesTargetMesgs: [{ thresholdHeartRate: 160 }],
    };
    expect(extractFitMetrics(messages).lactateThreshold).toEqual({
      heartRateBpm: 168,
      paceMps: 3.61,
    });
  });

  it("falls back to zones_target threshold heart rate", () => {
    const messages: DecodedFitMessages = {
      sessionMesgs: [{ totalDistance: 10000 }],
      zonesTargetMesgs: [{ thresholdHeartRate: 165 }],
    };
    expect(extractFitMetrics(messages).lactateThreshold).toEqual({
      heartRateBpm: 165,
    });
  });

  it("converts raw numeric startTime from FIT epoch to unix epoch seconds", () => {
    // FIT epoch is 1989-12-31T00:00:00Z → unix offset 631065600
    const messages: DecodedFitMessages = {
      lapMesgs: [{ startTime: 1_000_000_000 }],
    };
    expect(extractFitMetrics(messages).laps[0].startTimeInSeconds).toBe(
      1_000_000_000 + 631065600,
    );
  });

  it("omits pace when speed is missing or zero", () => {
    const messages: DecodedFitMessages = {
      lapMesgs: [{ avgSpeed: 0 }, { totalDistance: 100 }],
    };
    const { laps } = extractFitMetrics(messages);
    expect(laps[0].avgPaceSecondsPerKm).toBeUndefined();
    expect(laps[1].avgPaceSecondsPerKm).toBeUndefined();
  });

  it("falls back to array position when messageIndex is missing", () => {
    const messages: DecodedFitMessages = {
      lapMesgs: [{ totalDistance: 1 }, { totalDistance: 2 }],
    };
    const { laps } = extractFitMetrics(messages);
    expect(laps.map((l) => l.lapIndex)).toEqual([0, 1]);
  });
});

// ---------------------------------------------------------------------------
// decodeFitBuffer — real binary round-trip via the official fitsdk Encoder
// ---------------------------------------------------------------------------

describe("decodeFitBuffer", () => {
  function buildSyntheticFit(): Uint8Array {
    const encoder = new Encoder();

    const fileId: Encodable<FileIdMesg> = {
      mesgNum: Profile.MesgNum.FILE_ID,
      type: "activity",
      manufacturer: "garmin",
      product: 0,
      timeCreated: new Date("2026-06-01T08:00:00Z"),
      serialNumber: 1234,
    };
    const lap0: Encodable<LapMesg> = {
      mesgNum: Profile.MesgNum.LAP,
      messageIndex: 0,
      startTime: new Date("2026-06-01T08:00:00Z"),
      totalDistance: 1000,
      totalTimerTime: 300,
      avgSpeed: 3.33,
      avgHeartRate: 150,
      maxHeartRate: 160,
      totalAscent: 10,
    };
    const lap1: Encodable<LapMesg> = {
      mesgNum: Profile.MesgNum.LAP,
      messageIndex: 1,
      startTime: new Date("2026-06-01T08:05:00Z"),
      totalDistance: 2000,
      totalTimerTime: 540,
      avgSpeed: 3.7,
    };
    const session: Encodable<SessionMesg> = {
      mesgNum: Profile.MesgNum.SESSION,
      startTime: new Date("2026-06-01T08:00:00Z"),
      totalDistance: 3000,
      totalTimerTime: 840,
      avgSpeed: 3.57,
      avgStanceTime: 240.5,
      avgVerticalOscillation: 88.2,
      avgVerticalRatio: 8.1,
      avgStepLength: 1100,
    };
    const zonesTarget: Encodable<ZonesTargetMesg> = {
      mesgNum: Profile.MesgNum.ZONES_TARGET,
      thresholdHeartRate: 168,
    };

    encoder.writeMesg(fileId);
    encoder.writeMesg(lap0);
    encoder.writeMesg(lap1);
    encoder.writeMesg(session);
    encoder.writeMesg(zonesTarget);
    return encoder.close();
  }

  it("decodes a synthetic FIT binary end-to-end", () => {
    const metrics = decodeFitBuffer(buildSyntheticFit());

    expect(metrics.laps).toHaveLength(2);
    expect(metrics.laps[0]).toMatchObject({
      lapIndex: 0,
      totalDistanceMeters: 1000,
      totalTimerTimeSeconds: 300,
      avgHeartRate: 150,
      maxHeartRate: 160,
      totalAscentMeters: 10,
    });
    expect(metrics.laps[0].avgSpeedMps).toBeCloseTo(3.33, 2);
    expect(metrics.laps[0].avgPaceSecondsPerKm).toBeCloseTo(1000 / 3.33, 0);
    expect(metrics.laps[0].startTimeInSeconds).toBe(
      Math.floor(new Date("2026-06-01T08:00:00Z").getTime() / 1000),
    );
    expect(metrics.laps[1].lapIndex).toBe(1);

    expect(metrics.dynamics.avgGroundContactTimeMs).toBeCloseTo(240.5, 1);
    expect(metrics.dynamics.avgVerticalOscillationMm).toBeCloseTo(88.2, 1);
    expect(metrics.dynamics.avgVerticalRatioPct).toBeCloseTo(8.1, 1);
    expect(metrics.dynamics.avgStrideLengthM).toBeCloseTo(1.1, 3);

    expect(metrics.lactateThreshold.heartRateBpm).toBe(168);
  });

  it("works with a Node Buffer input", () => {
    const metrics = decodeFitBuffer(Buffer.from(buildSyntheticFit()));
    expect(metrics.laps).toHaveLength(2);
  });

  it("throws on a non-FIT buffer", () => {
    expect(() => decodeFitBuffer(Buffer.from("definitely not a fit file"))).toThrow(
      /not a FIT file/i,
    );
  });
});
