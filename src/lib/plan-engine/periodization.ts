/**
 * Periodization phase calculator.
 *
 * Computes training phase boundaries based on total weeks available,
 * following standard running periodization:
 *   Base (~40%) → Build (~30%) → Peak (~20%) → Taper (race-distance-aware)
 *
 * Taper length follows the evidence (Bosquet et al. 2007 meta-analysis:
 * ~2 weeks of exponential volume reduction of 41-60%, holding intensity
 * and frequency, maximizes performance) and scales with race distance —
 * a 5K needs far less freshening than a marathon.
 */

import { differenceInCalendarWeeks, parseISO } from "date-fns";

import type { PlanPhase } from "@/types/plan";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PhaseBoundary {
  phase: PlanPhase;
  startWeek: number;
  endWeek: number;
  /** Number of weeks in this phase */
  weeks: number;
}

export interface PeriodizationPlan {
  totalWeeks: number;
  phases: PhaseBoundary[];
}

// ---------------------------------------------------------------------------
// Phase calculation
// ---------------------------------------------------------------------------

/**
 * Evidence-based taper length in weeks for a goal race distance.
 *
 * Bosquet 2007: ~2 weeks optimal on average; shorter races need less
 * (the fitness cost of a long taper outweighs freshness for a 5K),
 * marathons benefit from the full 2-3 weeks of glycogen/tissue recovery.
 */
export function taperWeeksForDistance(
  raceDistanceMeters: number | undefined,
  totalWeeks: number,
): number {
  // Without a known race distance, fall back to the meta-analysis average.
  if (!raceDistanceMeters) {
    return Math.max(2, Math.min(3, Math.round(totalWeeks * 0.1)));
  }

  if (raceDistanceMeters <= 10_000) {
    // 5K/10K: ~1 week of freshening is enough
    return 1;
  }
  if (raceDistanceMeters <= 25_000) {
    // Half marathon: 1-2 weeks depending on plan length
    return totalWeeks >= 12 ? 2 : 1;
  }
  // Marathon and beyond: 2-3 weeks
  return Math.max(2, Math.min(3, Math.round(totalWeeks * 0.1)));
}

/**
 * Calculate periodization phases for a training plan.
 *
 * Handles total week counts from 4 to 30+.
 * For very short plans (< 8 weeks), phases are compressed or removed.
 *
 * @param totalWeeks - Plan weeks, race week included (see weeksUntilRace).
 * @param raceDistanceMeters - Goal race distance; drives taper length
 *   (5K ≠ marathon). When omitted, a 2-3 week taper is used.
 * @returns Periodization plan with phase boundaries.
 */
export function calculatePeriodization(
  totalWeeks: number,
  raceDistanceMeters?: number,
): PeriodizationPlan {
  // Clamp to reasonable range
  const weeks = Math.max(4, Math.min(totalWeeks, 30));

  // For very short plans (4-7 weeks), use simplified phases
  if (weeks <= 5) {
    return {
      totalWeeks: weeks,
      phases: [
        { phase: "base", startWeek: 1, endWeek: weeks - 2, weeks: weeks - 2 },
        { phase: "build", startWeek: weeks - 1, endWeek: weeks - 1, weeks: 1 },
        { phase: "taper", startWeek: weeks, endWeek: weeks, weeks: 1 },
      ],
    };
  }

  if (weeks <= 7) {
    const baseWeeks = 2;
    const buildWeeks = weeks - 4;
    const peakWeeks = 1;
    const taperWeeks = 1;

    return buildPhases(weeks, baseWeeks, buildWeeks, peakWeeks, taperWeeks);
  }

  // Standard periodization for 8+ weeks
  const taperWeeks = Math.min(
    3,
    Math.max(1, taperWeeksForDistance(raceDistanceMeters, weeks)),
  );
  const remaining = weeks - taperWeeks;

  const baseWeeks = Math.round(remaining * 0.45);
  const buildWeeks = Math.round(remaining * 0.33);
  const peakWeeks = remaining - baseWeeks - buildWeeks;

  return buildPhases(weeks, baseWeeks, buildWeeks, peakWeeks, taperWeeks);
}

function buildPhases(
  totalWeeks: number,
  baseWeeks: number,
  buildWeeks: number,
  peakWeeks: number,
  taperWeeks: number,
): PeriodizationPlan {
  const phases: PhaseBoundary[] = [];
  let currentWeek = 1;

  if (baseWeeks > 0) {
    phases.push({
      phase: "base",
      startWeek: currentWeek,
      endWeek: currentWeek + baseWeeks - 1,
      weeks: baseWeeks,
    });
    currentWeek += baseWeeks;
  }

  if (buildWeeks > 0) {
    phases.push({
      phase: "build",
      startWeek: currentWeek,
      endWeek: currentWeek + buildWeeks - 1,
      weeks: buildWeeks,
    });
    currentWeek += buildWeeks;
  }

  if (peakWeeks > 0) {
    phases.push({
      phase: "peak",
      startWeek: currentWeek,
      endWeek: currentWeek + peakWeeks - 1,
      weeks: peakWeeks,
    });
    currentWeek += peakWeeks;
  }

  if (taperWeeks > 0) {
    phases.push({
      phase: "taper",
      startWeek: currentWeek,
      endWeek: currentWeek + taperWeeks - 1,
      weeks: taperWeeks,
    });
  }

  return { totalWeeks, phases };
}

/**
 * Determine the current phase for a given week number.
 */
export function getPhaseForWeek(
  plan: PeriodizationPlan,
  weekNumber: number,
): PlanPhase {
  for (const phase of plan.phases) {
    if (weekNumber >= phase.startWeek && weekNumber <= phase.endWeek) {
      return phase.phase;
    }
  }
  // Default to taper if beyond plan (race week)
  return "race_week";
}

/**
 * Determine whether a given week should be a step-back week
 * (reduced volume for recovery).
 *
 * Every 4th week of training is a step-back week, unless it falls
 * in the taper phase (which is already reduced).
 */
export function isStepBackWeek(
  plan: PeriodizationPlan,
  weekNumber: number,
): boolean {
  const phase = getPhaseForWeek(plan, weekNumber);
  if (phase === "taper" || phase === "race_week") return false;
  return weekNumber % 4 === 0;
}

/**
 * Plan weeks run Monday to Sunday starting with the current week, so the race
 * lands in week `weeksUntilRace`. Counting whole 7-day periods instead puts
 * race day a week early whenever the race falls later in its week than today.
 */
export function weeksUntilRace(raceDate: string, today: Date): number {
  return (
    differenceInCalendarWeeks(parseISO(raceDate), today, { weekStartsOn: 1 }) +
    1
  );
}
