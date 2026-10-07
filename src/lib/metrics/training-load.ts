/**
 * Weekly training load calculator.
 *
 * Computes training load metrics from completed activities for a given week,
 * including distance, duration, session count, and intensity distribution.
 */

import type { Database } from "@/lib/db";
import type { TrainingLoadSummary } from "@/types/metrics";
import { eq, and, between, asc } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { startOfWeek, endOfWeek, format } from "date-fns";

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Calculate training load for the week containing the given date.
 *
 * @param db - Database instance
 * @param userId - User ID
 * @param planId - Active plan ID (used to count planned/missed workouts)
 * @param weekDate - Any date within the target week (defaults to current week)
 */
export async function calculateTrainingLoad(
  db: Database,
  userId: string,
  planId: string,
  weekDate: Date = new Date(),
): Promise<TrainingLoadSummary> {
  const weekStart = startOfWeek(weekDate, { weekStartsOn: 1 }); // Monday
  const weekEnd = endOfWeek(weekDate, { weekStartsOn: 1 }); // Sunday
  const weekStartStr = format(weekStart, "yyyy-MM-dd");
  const weekEndStr = format(weekEnd, "yyyy-MM-dd");

  // Fetch completed activities and planned workouts in parallel
  const [activities, plannedWorkouts] = await Promise.all([
    db
      .select()
      .from(schema.activities)
      .where(
        and(
          eq(schema.activities.userId, userId),
          between(schema.activities.startTime, weekStart, weekEnd),
        ),
      )
      .orderBy(asc(schema.activities.startTime)),
    db
      .select()
      .from(schema.plannedWorkouts)
      .where(
        and(
          eq(schema.plannedWorkouts.planId, planId),
          between(
            schema.plannedWorkouts.scheduledDate,
            weekStartStr,
            weekEndStr,
          ),
        ),
      )
      .orderBy(asc(schema.plannedWorkouts.scheduledDate)),
  ]);

  // Calculate distance, duration, and RPE load
  let totalDistanceMeters = 0;
  let totalDurationSeconds = 0;
  const aerobicEffects: number[] = [];
  const anaerobicEffects: number[] = [];

  for (const activity of activities) {
    if (activity.distanceMeters) {
      totalDistanceMeters += parseFloat(String(activity.distanceMeters));
    }
    totalDurationSeconds += activity.durationSeconds;

    if (activity.trainingEffectAerobic) {
      aerobicEffects.push(
        parseFloat(String(activity.trainingEffectAerobic)),
      );
    }
    if (activity.trainingEffectAnaerobic) {
      anaerobicEffects.push(
        parseFloat(String(activity.trainingEffectAnaerobic)),
      );
    }
  }

  // Foster (1998) RPE load from planned_workouts with rpeScore
  const rpeWorkouts = plannedWorkouts.filter(
    (w) => w.completionStatus === "completed" && w.rpeScore != null,
  );
  const rpeScores = rpeWorkouts.map((w) => w.rpeScore!);
  const avgRpeScore = rpeScores.length > 0
    ? round2(rpeScores.reduce((a, b) => a + b, 0) / rpeScores.length)
    : null;
  const sessionRpeLoad = rpeWorkouts.length > 0
    ? round2(rpeWorkouts.reduce((sum, w) => {
        const durationMin = w.targetDurationSeconds ? w.targetDurationSeconds / 60 : 0;
        return sum + (w.rpeScore! * durationMin);
      }, 0))
    : null;

  // Count workout statuses
  const workoutsPlanned = plannedWorkouts.filter(
    (w) => w.workoutType !== "rest",
  ).length;
  const workoutsCompleted = plannedWorkouts.filter(
    (w) => w.completionStatus === "completed",
  ).length;
  const workoutsMissed = plannedWorkouts.filter(
    (w) =>
      w.completionStatus === "skipped" ||
      (w.completionStatus === "pending" &&
        w.scheduledDate < format(new Date(), "yyyy-MM-dd")),
  ).length;

  // Intensity distribution based on training effect
  const intensityDistribution = classifyIntensity(activities);

  return {
    weekStartDate: weekStartStr,
    totalDistanceKm: round2(totalDistanceMeters / 1000),
    totalDurationMinutes: round2(totalDurationSeconds / 60),
    workoutsCompleted,
    workoutsPlanned,
    workoutsMissed,
    avgAerobicTrainingEffect: safeAverage(aerobicEffects),
    avgAnaerobicTrainingEffect: safeAverage(anaerobicEffects),
    intensityDistribution,
    sessionRpeLoad,
    avgRpeScore,
    rpeDataPoints: rpeScores.length,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Classify activities into easy/moderate/hard based on training effect.
 *
 * Training Effect scale (Garmin):
 * - 0-1.9: Easy (minor benefit)
 * - 2.0-3.4: Moderate (maintaining/improving aerobic fitness)
 * - 3.5-5.0: Hard (highly improving / overreaching)
 */
function classifyIntensity(
  activities: { trainingEffectAerobic: string | null }[],
): { easy: number; moderate: number; hard: number } {
  let easy = 0;
  let moderate = 0;
  let hard = 0;

  for (const activity of activities) {
    const te = activity.trainingEffectAerobic
      ? parseFloat(String(activity.trainingEffectAerobic))
      : null;

    if (te == null || te < 2.0) {
      easy++;
    } else if (te < 3.5) {
      moderate++;
    } else {
      hard++;
    }
  }

  return { easy, moderate, hard };
}

function safeAverage(values: number[]): number | null {
  if (values.length === 0) return null;
  return round2(values.reduce((a, b) => a + b, 0) / values.length);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
