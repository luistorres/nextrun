/**
 * VDOT-based pace calculator.
 *
 * Implements a simplified version of Jack Daniels' VDOT tables.
 * Given a recent race result or estimated fitness, computes training paces
 * for all workout types.
 *
 * All paces returned in seconds per kilometer.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrainingPaces {
  /** Recovery / very easy pace (sec/km) */
  recovery: { min: number; max: number };
  /** Easy / aerobic pace (sec/km) */
  easy: { min: number; max: number };
  /** Marathon pace (sec/km) */
  marathon: { min: number; max: number };
  /** Threshold / tempo pace (sec/km) */
  threshold: { min: number; max: number };
  /** Interval / VO2max pace (sec/km) */
  interval: { min: number; max: number };
  /** Repetition pace (sec/km) — fast, short reps */
  repetition: { min: number; max: number };
}

export interface RaceResult {
  /** Race distance in meters */
  distanceMeters: number;
  /** Finish time in seconds */
  timeSeconds: number;
}

// ---------------------------------------------------------------------------
// VDOT lookup table
//
// Simplified table based on Daniels' Running Formula.
// Maps VDOT values to training paces (seconds per km).
// Each entry: [vdot, easy, marathon, threshold, interval, repetition]
// Paces are midpoints; we add +/- margins for ranges.
// ---------------------------------------------------------------------------

interface VDOTEntry {
  vdot: number;
  easy: number;       // sec/km
  marathon: number;   // sec/km
  threshold: number;  // sec/km
  interval: number;   // sec/km
  repetition: number; // sec/km
}

const VDOT_TABLE: VDOTEntry[] = [
  { vdot: 30, easy: 447, marathon: 396, threshold: 372, interval: 345, repetition: 324 },
  { vdot: 32, easy: 432, marathon: 381, threshold: 357, interval: 330, repetition: 309 },
  { vdot: 34, easy: 417, marathon: 366, threshold: 342, interval: 317, repetition: 297 },
  { vdot: 36, easy: 402, marathon: 354, threshold: 330, interval: 305, repetition: 285 },
  { vdot: 38, easy: 390, marathon: 342, threshold: 318, interval: 294, repetition: 275 },
  { vdot: 40, easy: 378, marathon: 330, threshold: 307, interval: 284, repetition: 265 },
  { vdot: 42, easy: 366, marathon: 319, threshold: 297, interval: 274, repetition: 256 },
  { vdot: 44, easy: 354, marathon: 309, threshold: 288, interval: 266, repetition: 248 },
  { vdot: 46, easy: 345, marathon: 300, threshold: 279, interval: 258, repetition: 241 },
  { vdot: 48, easy: 336, marathon: 291, threshold: 271, interval: 250, repetition: 234 },
  { vdot: 50, easy: 327, marathon: 283, threshold: 264, interval: 243, repetition: 228 },
  { vdot: 52, easy: 318, marathon: 276, threshold: 257, interval: 237, repetition: 222 },
  { vdot: 54, easy: 310, marathon: 269, threshold: 250, interval: 231, repetition: 216 },
  { vdot: 56, easy: 303, marathon: 262, threshold: 244, interval: 225, repetition: 211 },
  { vdot: 58, easy: 296, marathon: 256, threshold: 238, interval: 220, repetition: 206 },
  { vdot: 60, easy: 289, marathon: 250, threshold: 233, interval: 215, repetition: 201 },
  { vdot: 62, easy: 282, marathon: 245, threshold: 228, interval: 210, repetition: 197 },
  { vdot: 64, easy: 276, marathon: 240, threshold: 223, interval: 206, repetition: 193 },
  { vdot: 66, easy: 270, marathon: 235, threshold: 219, interval: 202, repetition: 189 },
  { vdot: 68, easy: 264, marathon: 230, threshold: 215, interval: 198, repetition: 186 },
  { vdot: 70, easy: 259, marathon: 226, threshold: 211, interval: 195, repetition: 183 },
  { vdot: 75, easy: 247, marathon: 215, threshold: 201, interval: 186, repetition: 174 },
  { vdot: 80, easy: 237, marathon: 206, threshold: 192, interval: 178, repetition: 167 },
  { vdot: 85, easy: 228, marathon: 198, threshold: 185, interval: 171, repetition: 161 },
];

// ---------------------------------------------------------------------------
// VDOT estimation from race result
// ---------------------------------------------------------------------------

/**
 * VDOT estimation from a race result using the Daniels approximation.
 *
 * Uses a simplified formula. For common race distances (5K, 10K, half, full),
 * accuracy is within ~1-2 VDOT points of the full formula.
 */
export function estimateVDOT(race: RaceResult): number {
  const timeMin = race.timeSeconds / 60;

  // Velocity in meters per minute
  const velocity = race.distanceMeters / timeMin;

  // Simplified Daniels VO2 estimate from velocity
  // VO2 = -4.60 + 0.182258 * v + 0.000104 * v^2
  const vo2 = -4.6 + 0.182258 * velocity + 0.000104 * velocity * velocity;

  // Fraction of VO2max utilized based on race duration
  // %VO2max = 0.8 + 0.1894393 * e^(-0.012778 * t) + 0.2989558 * e^(-0.1932605 * t)
  const fracVO2max =
    0.8 +
    0.1894393 * Math.exp(-0.012778 * timeMin) +
    0.2989558 * Math.exp(-0.1932605 * timeMin);

  const vdot = vo2 / fracVO2max;

  // Clamp to our table range
  return Math.max(30, Math.min(85, Math.round(vdot)));
}

/**
 * Estimate VDOT from a simple average easy-run pace.
 * Less accurate than a race result, but useful when no race data exists.
 *
 * @param easyPaceSecsPerKm - The runner's typical easy pace in seconds per km.
 */
export function estimateVDOTFromEasyPace(easyPaceSecsPerKm: number): number {
  // Find the closest VDOT entry by easy pace
  let closest = VDOT_TABLE[0];
  let minDiff = Math.abs(VDOT_TABLE[0].easy - easyPaceSecsPerKm);

  for (const entry of VDOT_TABLE) {
    const diff = Math.abs(entry.easy - easyPaceSecsPerKm);
    if (diff < minDiff) {
      minDiff = diff;
      closest = entry;
    }
  }

  return closest.vdot;
}

// ---------------------------------------------------------------------------
// Easy-run filtering + VDOT from recent runs
// ---------------------------------------------------------------------------

/** Minimal shape of a recent run needed for easy-effort filtering. */
export interface RunSample {
  /** Average pace in seconds per km */
  avgPaceSecsPerKm: number;
  /** Average heart rate, if recorded */
  avgHR?: number;
}

/** Fallback estimated max HR when the athlete's true max is unknown. */
const FALLBACK_MAX_HR = 190;
/** Fraction of max HR at or below which a run counts as an easy effort. */
const EASY_HR_FRACTION = 0.78;
/** ~78% of 190 bpm fallback max ≈ 148 bpm. */
const EASY_HR_CEILING = Math.round(FALLBACK_MAX_HR * EASY_HR_FRACTION);

/**
 * Filter a set of recent runs down to genuinely easy efforts.
 *
 * Tempo/interval sessions run faster than easy pace; averaging them in
 * inflates the VDOT estimate and produces too-aggressive prescribed paces.
 *
 * - Runs with HR data: easy when avgHR <= ~78% of estimated max (190 fallback).
 * - Runs without HR data: easy when pace is at or slower than the median pace
 *   of the paced runs in the set.
 *
 * Runs without a usable pace (<= 0) are always excluded.
 */
export function filterEasyRuns(runs: RunSample[]): RunSample[] {
  const withPace = runs.filter((r) => r.avgPaceSecsPerKm > 0);
  if (withPace.length === 0) return [];

  const sortedPaces = withPace
    .map((r) => r.avgPaceSecsPerKm)
    .sort((a, b) => a - b);
  const mid = Math.floor(sortedPaces.length / 2);
  const medianPace =
    sortedPaces.length % 2 !== 0
      ? sortedPaces[mid]
      : (sortedPaces[mid - 1] + sortedPaces[mid]) / 2;

  return withPace.filter((r) =>
    r.avgHR != null && r.avgHR > 0
      ? r.avgHR <= EASY_HR_CEILING
      : r.avgPaceSecsPerKm >= medianPace,
  );
}

/**
 * Estimate VDOT from recent runs, using only genuinely easy efforts.
 *
 * Falls back to averaging all paced runs when nothing qualifies as easy
 * (preserves the previous behavior). Returns null when no run has a pace.
 */
export function estimateVDOTFromRecentRuns(runs: RunSample[]): number | null {
  const withPace = runs.filter((r) => r.avgPaceSecsPerKm > 0);
  if (withPace.length === 0) return null;

  const easyRuns = filterEasyRuns(withPace);
  const sample = easyRuns.length > 0 ? easyRuns : withPace;
  const avgPace =
    sample.reduce((sum, r) => sum + r.avgPaceSecsPerKm, 0) / sample.length;

  return estimateVDOTFromEasyPace(avgPace);
}

// ---------------------------------------------------------------------------
// Goal vs current fitness blending
// ---------------------------------------------------------------------------

/** Gap (in VDOT points) above current fitness at which a goal is treated as aspirational. */
export const GOAL_VDOT_BLEND_THRESHOLD = 3;

/**
 * Blend a goal-time-derived VDOT against current (recent-run-derived) fitness.
 *
 * A goal more than {@link GOAL_VDOT_BLEND_THRESHOLD} VDOT points above current
 * fitness is aspirational — anchoring every workout to it prescribes paces the
 * runner can't sustain yet. In that case, return the midpoint of the two.
 * Otherwise (or when current fitness is unknown) keep the goal VDOT as-is.
 */
export function blendGoalAndCurrentVdot(
  goalVdot: number,
  currentVdot: number | null,
): { vdot: number; blended: boolean } {
  if (
    currentVdot == null ||
    goalVdot - currentVdot <= GOAL_VDOT_BLEND_THRESHOLD
  ) {
    return { vdot: goalVdot, blended: false };
  }
  return { vdot: (goalVdot + currentVdot) / 2, blended: true };
}

// ---------------------------------------------------------------------------
// Pace lookup with interpolation
// ---------------------------------------------------------------------------

/**
 * Look up training paces for a given VDOT value.
 * Interpolates between table entries for values that aren't exact matches.
 */
export function getTrainingPaces(vdot: number): TrainingPaces {
  const clampedVdot = Math.max(30, Math.min(85, vdot));

  // Find bounding entries
  let lower = VDOT_TABLE[0];
  let upper = VDOT_TABLE[VDOT_TABLE.length - 1];

  for (let i = 0; i < VDOT_TABLE.length - 1; i++) {
    if (
      VDOT_TABLE[i].vdot <= clampedVdot &&
      VDOT_TABLE[i + 1].vdot >= clampedVdot
    ) {
      lower = VDOT_TABLE[i];
      upper = VDOT_TABLE[i + 1];
      break;
    }
  }

  // Linear interpolation factor
  const range = upper.vdot - lower.vdot;
  const t = range === 0 ? 0 : (clampedVdot - lower.vdot) / range;

  function lerp(a: number, b: number): number {
    return Math.round(a + (b - a) * t);
  }

  const easy = lerp(lower.easy, upper.easy);
  const marathon = lerp(lower.marathon, upper.marathon);
  const threshold = lerp(lower.threshold, upper.threshold);
  const interval = lerp(lower.interval, upper.interval);
  const repetition = lerp(lower.repetition, upper.repetition);

  // Pace ranges: +/- a margin to give an acceptable window
  return {
    recovery: { min: easy + 15, max: easy + 35 },
    easy: { min: easy - 10, max: easy + 15 },
    marathon: { min: marathon - 5, max: marathon + 10 },
    threshold: { min: threshold - 5, max: threshold + 8 },
    interval: { min: interval - 5, max: interval + 8 },
    repetition: { min: repetition - 5, max: repetition + 8 },
  };
}

/**
 * Calculate training paces from a race result.
 */
export function pacesFromRace(race: RaceResult): TrainingPaces {
  const vdot = estimateVDOT(race);
  return getTrainingPaces(vdot);
}

/**
 * Calculate training paces from a goal race time.
 * This gives paces appropriate for someone who CAN run that time —
 * useful for determining target paces for workouts.
 */
export function pacesFromGoalTime(
  distanceMeters: number,
  goalTimeSeconds: number,
): TrainingPaces {
  const vdot = estimateVDOT({ distanceMeters, timeSeconds: goalTimeSeconds });
  return getTrainingPaces(vdot);
}

/**
 * Predict race time for a given VDOT and distance.
 *
 * Inverts the `estimateVDOT()` formula via binary search:
 * finds the time (in seconds) that produces the target VDOT
 * for the given distance. 50 iterations → sub-second precision.
 *
 * @param vdot - Target VDOT value (30–85)
 * @param distanceMeters - Race distance in meters
 * @returns Predicted finish time in seconds
 */
export function predictRaceTime(vdot: number, distanceMeters: number): number {
  const clampedVdot = Math.max(30, Math.min(85, vdot));
  const distKm = distanceMeters / 1000;

  // Search bounds: 2.5 min/km (elite) to 10 min/km (slow)
  let lo = distKm * 150; // seconds
  let hi = distKm * 600; // seconds

  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const estimated = estimateVDOTRaw({
      distanceMeters,
      timeSeconds: mid,
    });

    if (estimated > clampedVdot) {
      // Time is too fast → predicted VDOT is higher → slow down
      lo = mid;
    } else {
      // Time is too slow → predicted VDOT is lower → speed up
      hi = mid;
    }
  }

  return Math.round((lo + hi) / 2);
}

/**
 * Raw VDOT estimation (unclamped, unrounded) for internal use by predictRaceTime.
 */
function estimateVDOTRaw(race: RaceResult): number {
  const timeMin = race.timeSeconds / 60;
  const velocity = race.distanceMeters / timeMin;
  const vo2 = -4.6 + 0.182258 * velocity + 0.000104 * velocity * velocity;
  const fracVO2max =
    0.8 +
    0.1894393 * Math.exp(-0.012778 * timeMin) +
    0.2989558 * Math.exp(-0.1932605 * timeMin);
  return vo2 / fracVO2max;
}

/**
 * Format a pace in seconds/km to a human-readable "M:SS/km" string.
 */
export function formatPace(secsPerKm: number): string {
  const min = Math.floor(secsPerKm / 60);
  const sec = Math.round(secsPerKm % 60);
  return `${min}:${sec.toString().padStart(2, "0")}/km`;
}
