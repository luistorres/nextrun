/**
 * Workout preference inference from adaptation history and RPE data.
 *
 * Implements a simplified version of the RLHF feedback loop from
 * He et al. (2026): instead of model fine-tuning, preference signals
 * are injected into future prompts to guide Claude's decisions.
 *
 * Two signal sources:
 * 1. Adaptation acceptance/rejection history → adaptation style preferences
 * 2. RPE scores by workout type → effort tolerance per workout type
 */

import type { Database } from "@/lib/db";
import { eq, and, gte, isNotNull } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { subDays, format } from "date-fns";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkoutPreferenceSummary {
  /** Adaptation acceptance rate (0–1), null when insufficient data */
  acceptanceRate: number | null;
  /** Number of accepted adaptations */
  acceptedCount: number;
  /** Number of rejected adaptations */
  rejectedCount: number;
  /** Workout types with consistently high RPE (≥8 avg) — harder than expected */
  highRpeWorkoutTypes: string[];
  /** Workout types with consistent execution quality (RPE 5–7 avg) */
  wellExecutedWorkoutTypes: string[];
  /** Number of adaptation records evaluated */
  adaptationDataPoints: number;
  /** Number of workouts with RPE data evaluated */
  rpeDataPoints: number;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Infer athlete preferences from adaptation history and RPE signals.
 *
 * @param db - Database instance
 * @param userId - User ID
 * @param planId - Active plan ID (for scoping RPE data to this plan)
 * @param asOf - Reference date (defaults to now)
 */
export async function calculateWorkoutPreferences(
  db: Database,
  userId: string,
  planId: string,
  asOf: Date = new Date(),
): Promise<WorkoutPreferenceSummary> {
  const ninetyDaysAgo = subDays(asOf, 90);
  const ninetyDaysAgoStr = format(ninetyDaysAgo, "yyyy-MM-dd");

  // ── 1. Adaptation acceptance/rejection history ─────────────────────
  const adaptationRows = await db
    .select({
      accepted: schema.adaptations.accepted,
    })
    .from(schema.adaptations)
    .where(
      and(
        eq(schema.adaptations.planId, planId),
        gte(schema.adaptations.createdAt, ninetyDaysAgo),
        isNotNull(schema.adaptations.accepted),
      ),
    );

  const acceptedCount = adaptationRows.filter((r) => r.accepted === true).length;
  const rejectedCount = adaptationRows.filter((r) => r.accepted === false).length;
  const total = acceptedCount + rejectedCount;
  const acceptanceRate = total >= 2 ? acceptedCount / total : null;

  // ── 2. RPE scores grouped by workout type ──────────────────────────
  const rpeRows = await db
    .select({
      workoutType: schema.plannedWorkouts.workoutType,
      rpeScore: schema.plannedWorkouts.rpeScore,
    })
    .from(schema.plannedWorkouts)
    .where(
      and(
        eq(schema.plannedWorkouts.planId, planId),
        eq(schema.plannedWorkouts.completionStatus, "completed"),
        isNotNull(schema.plannedWorkouts.rpeScore),
        gte(schema.plannedWorkouts.scheduledDate, ninetyDaysAgoStr),
      ),
    );

  // Group RPE scores by workout type
  const rpeByType = new Map<string, number[]>();
  for (const row of rpeRows) {
    if (row.rpeScore == null) continue;
    const existing = rpeByType.get(row.workoutType) ?? [];
    existing.push(row.rpeScore);
    rpeByType.set(row.workoutType, existing);
  }

  const highRpeWorkoutTypes: string[] = [];
  const wellExecutedWorkoutTypes: string[] = [];

  for (const [workoutType, scores] of rpeByType) {
    if (scores.length < 2) continue; // Require ≥2 data points

    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;

    if (avg >= 8) {
      highRpeWorkoutTypes.push(workoutType);
    } else if (avg >= 5 && avg < 8) {
      wellExecutedWorkoutTypes.push(workoutType);
    }
  }

  return {
    acceptanceRate,
    acceptedCount,
    rejectedCount,
    highRpeWorkoutTypes,
    wellExecutedWorkoutTypes,
    adaptationDataPoints: total,
    rpeDataPoints: rpeRows.length,
  };
}
