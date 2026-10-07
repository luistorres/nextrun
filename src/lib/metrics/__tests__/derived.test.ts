import { describe, it, expect } from "vitest";
import { calculateTRIMP } from "../derived";

// ---------------------------------------------------------------------------
// TRIMP calculation
// ---------------------------------------------------------------------------

describe("calculateTRIMP", () => {
  it("assumes an easy-moderate session when no HR and no RPE", () => {
    // 30 min, no HR, no RPE → assumed 0.55 HRR through the Banister formula:
    // 30 × 0.55 × 0.64 × e^(1.92 × 0.55) ≈ 30.3 — comparable to an easy run
    // with HR, instead of the old 30 × 0.5 = 15 that fabricated detraining.
    const trimp = calculateTRIMP(1800, null, null, 60);
    const easyWithHR = calculateTRIMP(1800, 130, 185, 55);
    expect(trimp).toBeGreaterThan(25);
    expect(trimp).toBeLessThan(easyWithHR * 1.5);
  });

  it("uses RPE to scale the no-HR estimate", () => {
    const hardNoHR = calculateTRIMP(1800, null, null, 60, 9); // RPE 9 → ~0.90 HRR
    const easyNoHR = calculateTRIMP(1800, null, null, 60, 3); // RPE 3 → ~0.60 HRR
    expect(hardNoHR).toBeGreaterThan(easyNoHR);
    // RPE 9 should land near a hard HR-based session of the same duration
    const hardWithHR = calculateTRIMP(1800, 172, 190, 55);
    expect(hardNoHR).toBeGreaterThan(hardWithHR * 0.6);
    expect(hardNoHR).toBeLessThan(hardWithHR * 1.6);
  });

  it("calculates TRIMP for easy run (low fractional HR)", () => {
    // 45 min, avg HR 130, max HR 185, resting 55
    // fractionalHR = (130-55) / (185-55) = 75/130 ≈ 0.577
    // TRIMP = 45 * 0.577 * 0.64 * e^(1.92 * 0.577)
    const trimp = calculateTRIMP(2700, 130, 185, 55);
    expect(trimp).toBeGreaterThan(30);
    expect(trimp).toBeLessThan(60);
  });

  it("calculates higher TRIMP for intense run", () => {
    // 30 min, avg HR 170, max HR 190, resting 55
    // fractionalHR = (170-55) / (190-55) = 115/135 ≈ 0.852
    const intenseTrimp = calculateTRIMP(1800, 170, 190, 55);
    // 30 min, avg HR 130, max HR 190, resting 55
    const easyTrimp = calculateTRIMP(1800, 130, 190, 55);

    expect(intenseTrimp).toBeGreaterThan(easyTrimp);
  });

  it("scales with duration", () => {
    const short = calculateTRIMP(1800, 150, 185, 55); // 30 min
    const long = calculateTRIMP(3600, 150, 185, 55); // 60 min
    // Twice the duration should give roughly twice the TRIMP
    expect(long).toBeCloseTo(short * 2, 0);
  });

  it("clamps fractional HR to 0-1 range", () => {
    // avgHR below resting (bad data) → fractionalHR clamped to 0
    const trimp = calculateTRIMP(1800, 50, 185, 60);
    expect(trimp).toBe(0); // 0.64 * e^0 = 0.64, but deltaHR is 0
  });

  it("uses fallback max HR of 190 when not provided", () => {
    const withMax = calculateTRIMP(1800, 150, 190, 55);
    const withoutMax = calculateTRIMP(1800, 150, null, 55);
    expect(withoutMax).toBeCloseTo(withMax, 1);
  });

  it("returns zero TRIMP for zero duration", () => {
    const trimp = calculateTRIMP(0, 150, 185, 55);
    expect(trimp).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Note: calculateACWR, calculateRecoveryReadiness, calculateSleepQuality,
// and calculatePaceEfficiency are async functions that require a database
// connection. They are tested via integration tests with seeded data.
// The core logic is tested through TRIMP and the classification functions.
// ---------------------------------------------------------------------------
