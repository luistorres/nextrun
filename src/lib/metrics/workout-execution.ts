/**
 * Workout execution quality module.
 *
 * For each completed planned workout in the last 14 days, computes how closely
 * the athlete actually executed it compared to what was planned (distance ratio,
 * duration ratio, execution quality label).
 *
 * This is used to distinguish "ran 5km on a day planned for 20km long run"
 * (partial) from "ran 20.2km as planned" (on target) — both mark the workout
 * as completionStatus="completed" but represent very different outcomes.
 */

import { and, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { subDays, format } from "date-fns";
import type { Database } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import type { WorkoutStep } from "@/types/plan";
import { aggregateLinkedActivities } from "./aggregate-linked-activities";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExecutionQuality = "exceeds" | "on_target" | "partial" | "minimal";

export interface WorkoutExecutionEntry {
  workoutId: string;
  scheduledDate: string;
  workoutType: string;
  plannedDistanceKm: number | null;
  actualDistanceKm: number;
  plannedDurationMin: number | null;
  actualDurationMin: number;
  /** Ratio of actual / planned distance (null if no target distance set) */
  distanceRatio: number | null;
  /** Quality label based on distanceRatio (null if no target) */
  executionQuality: ExecutionQuality | null;
  /**
   * Percentage (0-100) of analyzed lap distance run within the prescribed
   * pace range. Only set when the activity has decoded FIT laps AND the
   * planned workout has pace-targeted steps. See calculatePaceDiscipline.
   */
  paceDisciplinePct?: number;
  /** Number of laps that were matched to pace-targeted steps */
  lapsAnalyzed?: number;
}

export interface WorkoutExecutionSummary {
  entries: WorkoutExecutionEntry[];
  /**
   * Average distance ratio across KEY workout types only:
   * tempo, intervals, long_run, hill_repeats, race_pace.
   * null if no key workouts with targets were completed.
   */
  avgDistanceRatioKeyWorkouts: number | null;
  /**
   * True if any key workout was completed at <60% of its target distance,
   * meaning the purpose of the session was likely not achieved.
   */
  hasSignificantUnderExecution: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Workout types where execution quality really matters for training stimulus */
const KEY_WORKOUT_TYPES = new Set([
  "tempo",
  "intervals",
  "long_run",
  "hill_repeats",
  "race_pace",
]);

/** Threshold below which a key workout is considered significantly under-executed */
const UNDER_EXECUTION_THRESHOLD = 0.6;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Calculate per-workout execution quality for all completed planned workouts
 * in the last 14 days that have a linked activity.
 *
 * @param db - Database instance
 * @param userId - The user to evaluate
 * @param planId - The active plan ID
 * @param asOf - Reference date (default: now)
 */
export async function calculateWorkoutExecutionSummary(
  db: Database,
  userId: string,
  planId: string,
  asOf: Date = new Date(),
): Promise<WorkoutExecutionSummary> {
  const fourteenDaysAgo = format(subDays(asOf, 14), "yyyy-MM-dd");

  // Fetch completed workouts with a linked activity (completedActivityId set)
  const completedWorkouts = await db
    .select()
    .from(schema.plannedWorkouts)
    .where(
      and(
        eq(schema.plannedWorkouts.planId, planId),
        eq(schema.plannedWorkouts.completionStatus, "completed"),
        isNotNull(schema.plannedWorkouts.completedActivityId),
        gte(schema.plannedWorkouts.scheduledDate, fourteenDaysAgo),
      ),
    );

  if (completedWorkouts.length === 0) {
    return {
      entries: [],
      avgDistanceRatioKeyWorkouts: null,
      hasSignificantUnderExecution: false,
    };
  }

  // Fetch ALL activities linked to these workouts via plannedWorkoutId.
  // This captures both the primary activity (completedActivityId) and any
  // secondary activities from split sessions on the same day.
  const workoutIds = completedWorkouts.map((w) => w.id);

  const allLinkedActivities = await db
    .select({
      id: schema.activities.id,
      plannedWorkoutId: schema.activities.plannedWorkoutId,
      distanceMeters: schema.activities.distanceMeters,
      durationSeconds: schema.activities.durationSeconds,
      startTime: schema.activities.startTime,
    })
    .from(schema.activities)
    .where(
      and(
        eq(schema.activities.userId, userId),
        inArray(schema.activities.plannedWorkoutId, workoutIds),
      ),
    );

  // Decoded FIT laps for those activities (used for pace-discipline scoring;
  // empty for activities whose FIT file was never captured/decoded).
  const activityIds = allLinkedActivities.map((a) => a.id);
  const allLaps =
    activityIds.length > 0
      ? await db
          .select({
            activityId: schema.activityLaps.activityId,
            lapIndex: schema.activityLaps.lapIndex,
            totalDistanceMeters: schema.activityLaps.totalDistanceMeters,
            avgPaceSecondsPerKm: schema.activityLaps.avgPaceSecondsPerKm,
          })
          .from(schema.activityLaps)
          .where(inArray(schema.activityLaps.activityId, activityIds))
      : [];

  const lapsByActivity = new Map<string, PaceDisciplineLap[]>();
  for (const lap of allLaps) {
    const existing = lapsByActivity.get(lap.activityId) ?? [];
    existing.push({
      lapIndex: lap.lapIndex,
      totalDistanceMeters: lap.totalDistanceMeters
        ? Number(lap.totalDistanceMeters)
        : null,
      avgPaceSecondsPerKm: lap.avgPaceSecondsPerKm
        ? Number(lap.avgPaceSecondsPerKm)
        : null,
    });
    lapsByActivity.set(lap.activityId, existing);
  }

  // Group by plannedWorkoutId
  const activitiesByWorkout = new Map<string, typeof allLinkedActivities>();
  for (const a of allLinkedActivities) {
    if (!a.plannedWorkoutId) continue;
    const existing = activitiesByWorkout.get(a.plannedWorkoutId) ?? [];
    existing.push(a);
    activitiesByWorkout.set(a.plannedWorkoutId, existing);
  }

  // Build entries using aggregated metrics
  const entries: WorkoutExecutionEntry[] = [];

  for (const workout of completedWorkouts) {
    const linked = activitiesByWorkout.get(workout.id) ?? [];
    if (linked.length === 0) continue;

    const aggregated = aggregateLinkedActivities(linked);

    const actualDistanceKm = aggregated.totalDistanceMeters / 1000;
    const actualDurationMin = aggregated.totalDurationSeconds / 60;

    const plannedDistanceKm = workout.targetDistanceMeters
      ? workout.targetDistanceMeters / 1000
      : null;
    const plannedDurationMin = workout.targetDurationSeconds
      ? workout.targetDurationSeconds / 60
      : null;

    let distanceRatio: number | null = null;
    let executionQuality: ExecutionQuality | null = null;

    if (plannedDistanceKm !== null && plannedDistanceKm > 0) {
      distanceRatio = actualDistanceKm / plannedDistanceKm;
      executionQuality = classifyExecutionQuality(distanceRatio);
    }

    // Pace discipline: requires decoded FIT laps + pace-targeted steps.
    // Laps from split sessions are concatenated in chronological order.
    let paceDiscipline: PaceDisciplineResult | null = null;
    if (workout.workoutSteps && workout.workoutSteps.length > 0) {
      const orderedActivities = [...linked].sort(
        (a, b) => a.startTime.getTime() - b.startTime.getTime(),
      );
      const workoutLaps: PaceDisciplineLap[] = [];
      for (const activity of orderedActivities) {
        const activityLaps = (lapsByActivity.get(activity.id) ?? []).sort(
          (a, b) => a.lapIndex - b.lapIndex,
        );
        for (const lap of activityLaps) {
          workoutLaps.push({ ...lap, lapIndex: workoutLaps.length });
        }
      }
      if (workoutLaps.length > 0) {
        paceDiscipline = calculatePaceDiscipline(
          workoutLaps,
          workout.workoutSteps,
        );
      }
    }

    entries.push({
      workoutId: workout.id,
      scheduledDate: workout.scheduledDate,
      workoutType: workout.workoutType,
      plannedDistanceKm,
      actualDistanceKm,
      plannedDurationMin,
      actualDurationMin,
      distanceRatio,
      executionQuality,
      ...(paceDiscipline !== null
        ? {
            paceDisciplinePct: paceDiscipline.paceDisciplinePct,
            lapsAnalyzed: paceDiscipline.lapsAnalyzed,
          }
        : {}),
    });
  }

  // Compute aggregate for key workout types
  const keyEntries = entries.filter(
    (e) => KEY_WORKOUT_TYPES.has(e.workoutType) && e.distanceRatio !== null,
  );

  const avgDistanceRatioKeyWorkouts =
    keyEntries.length > 0
      ? keyEntries.reduce((sum, e) => sum + (e.distanceRatio ?? 0), 0) /
        keyEntries.length
      : null;

  const hasSignificantUnderExecution = keyEntries.some(
    (e) => (e.distanceRatio ?? 1) < UNDER_EXECUTION_THRESHOLD,
  );

  return {
    entries,
    avgDistanceRatioKeyWorkouts,
    hasSignificantUnderExecution,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function classifyExecutionQuality(ratio: number): ExecutionQuality {
  if (ratio > 1.1) return "exceeds";
  if (ratio >= 0.8) return "on_target";
  if (ratio >= 0.4) return "partial";
  return "minimal";
}

// ---------------------------------------------------------------------------
// Per-lap pace discipline
// ---------------------------------------------------------------------------

/** Minimal lap shape needed for pace-discipline scoring (decoded FIT laps). */
export interface PaceDisciplineLap {
  lapIndex: number;
  totalDistanceMeters: number | null;
  avgPaceSecondsPerKm: number | null;
}

export interface PaceDisciplineResult {
  /** Percentage (0-100) of analyzed lap distance inside the prescribed range */
  paceDisciplinePct: number;
  /** Laps matched to pace-targeted steps with usable distance + pace */
  lapsAnalyzed: number;
}

/** A planned step flattened into a sequential segment with optional pace range. */
interface PrescribedSegment {
  /** Pace range in sec/km (min = faster bound). Undefined when not pace-targeted. */
  targetMinSecPerKm?: number;
  targetMaxSecPerKm?: number;
  /** Estimated segment distance in meters, null when inestimable */
  estDistanceMeters: number | null;
}

/** Advance to the next segment once 90% of its estimated distance is consumed
 * (tolerates devices auto-lapping slightly before the step boundary). */
const SEGMENT_ADVANCE_FRACTION = 0.9;

interface StepLeg {
  durationType: "time" | "distance" | "open";
  durationValue?: number;
  targetType: "pace" | "heart_rate" | "open";
  targetMin?: number;
  targetMax?: number;
}

function legToSegment(leg: StepLeg): PrescribedSegment {
  const isPaceTarget =
    leg.targetType === "pace" &&
    (leg.targetMin !== undefined || leg.targetMax !== undefined);

  // Normalize: targetMin must be the numerically smaller (faster) bound.
  let min: number | undefined;
  let max: number | undefined;
  if (isPaceTarget) {
    if (leg.targetMin !== undefined && leg.targetMax !== undefined) {
      min = Math.min(leg.targetMin, leg.targetMax);
      max = Math.max(leg.targetMin, leg.targetMax);
    } else {
      min = leg.targetMin;
      max = leg.targetMax;
    }
  }

  // Estimate distance: explicit for distance-based steps; for time-based
  // pace-targeted steps, derived from the midpoint of the pace range.
  let estDistanceMeters: number | null = null;
  if (leg.durationType === "distance" && leg.durationValue) {
    estDistanceMeters = leg.durationValue;
  } else if (leg.durationType === "time" && leg.durationValue && isPaceTarget) {
    const midPace = min !== undefined && max !== undefined ? (min + max) / 2 : (min ?? max)!;
    if (midPace > 0) {
      estDistanceMeters = (leg.durationValue / midPace) * 1000;
    }
  }

  return { targetMinSecPerKm: min, targetMaxSecPerKm: max, estDistanceMeters };
}

/** Flatten workout steps (expanding interval repeats) into ordered segments. */
function expandStepsToSegments(steps: WorkoutStep[]): PrescribedSegment[] {
  const segments: PrescribedSegment[] = [];
  const ordered = [...steps].sort((a, b) => a.order - b.order);

  for (const step of ordered) {
    if (step.type === "interval") {
      const repeats = Math.max(1, step.repeatCount);
      for (let i = 0; i < repeats; i++) {
        segments.push(legToSegment(step.workStep));
        segments.push(legToSegment(step.restStep));
      }
    } else {
      segments.push(legToSegment(step));
    }
  }

  return segments;
}

/**
 * Per-lap pace-discipline score: the fraction of lap distance run within the
 * prescribed pace range of the matching planned step.
 *
 * APPROXIMATION — greedy sequential alignment of laps to steps by cumulative
 * distance: laps and flattened steps are walked in order; a lap is assigned
 * to the current step, and the step is "consumed" once ~90% of its estimated
 * distance is covered by assigned laps. Steps whose distance cannot be
 * estimated (open / time-based without a pace target, e.g. interval
 * recoveries) consume exactly one lap, matching Garmin's auto-lap-per-step
 * behavior for synced structured workouts. Laps beyond the final step are
 * assigned to it (extended cooldowns). This is heuristic: athletes who
 * manually lap or run a different structure than prescribed may be
 * misaligned, which is acceptable for a coarse adaptation signal.
 *
 * Whole laps are scored binary in/out of range (inclusive bounds, missing
 * bound = unbounded on that side), weighted by lap distance.
 *
 * Returns null when there are no pace-targeted steps, no usable laps, or no
 * lap distance could be matched to a pace-targeted step.
 */
export function calculatePaceDiscipline(
  laps: PaceDisciplineLap[],
  steps: WorkoutStep[],
): PaceDisciplineResult | null {
  const segments = expandStepsToSegments(steps);
  const hasPaceTargets = segments.some(
    (s) => s.targetMinSecPerKm !== undefined || s.targetMaxSecPerKm !== undefined,
  );
  if (!hasPaceTargets || laps.length === 0) return null;

  const orderedLaps = [...laps].sort((a, b) => a.lapIndex - b.lapIndex);

  let segmentIdx = 0;
  let consumedInSegment = 0;
  let analyzedDistance = 0;
  let inZoneDistance = 0;
  let lapsAnalyzed = 0;

  for (const lap of orderedLaps) {
    const segment = segments[Math.min(segmentIdx, segments.length - 1)];
    const lapDistance = lap.totalDistanceMeters ?? 0;

    const isPaceSegment =
      segment.targetMinSecPerKm !== undefined ||
      segment.targetMaxSecPerKm !== undefined;

    if (isPaceSegment && lapDistance > 0 && lap.avgPaceSecondsPerKm !== null) {
      const pace = lap.avgPaceSecondsPerKm;
      const inZone =
        (segment.targetMinSecPerKm === undefined || pace >= segment.targetMinSecPerKm) &&
        (segment.targetMaxSecPerKm === undefined || pace <= segment.targetMaxSecPerKm);

      analyzedDistance += lapDistance;
      if (inZone) inZoneDistance += lapDistance;
      lapsAnalyzed++;
    }

    // Advance the segment pointer (greedy cumulative-distance consumption).
    if (segmentIdx < segments.length) {
      if (segment.estDistanceMeters !== null) {
        consumedInSegment += lapDistance;
        if (consumedInSegment >= segment.estDistanceMeters * SEGMENT_ADVANCE_FRACTION) {
          segmentIdx++;
          consumedInSegment = 0;
        }
      } else {
        // Inestimable distance → assume one lap per step (device auto-lap)
        segmentIdx++;
        consumedInSegment = 0;
      }
    }
  }

  if (analyzedDistance === 0) return null;

  return {
    paceDisciplinePct: Math.round((inZoneDistance / analyzedDistance) * 100),
    lapsAnalyzed,
  };
}
