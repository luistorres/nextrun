import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { plannedWorkouts, activities } from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// GET /api/workouts/[id] — Get a single workout with full details
// ---------------------------------------------------------------------------

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: workoutId } = await params;

    // Load the workout with its plan and goal context
    const workout = await db.query.plannedWorkouts.findFirst({
      where: eq(plannedWorkouts.id, workoutId),
      with: {
        plan: {
          with: {
            goal: true,
          },
        },
      },
    });

    if (!workout) {
      return NextResponse.json(
        { error: "Workout not found" },
        { status: 404 },
      );
    }

    // Verify the workout belongs to the authenticated user
    if (workout.plan.userId !== session.user.id) {
      return NextResponse.json(
        { error: "Workout not found" },
        { status: 404 },
      );
    }

    // If completed, fetch ALL linked activities (primary + secondary from split sessions)
    // and aggregate their metrics for a complete picture.
    let completedActivity: {
      distanceMeters: number | null;
      durationSeconds: number | null;
      avgPaceSecondsPerKm: number | null;
      avgHeartRate: number | null;
    } | null = null;
    let linkedActivityCount = 0;

    if (workout.completedActivityId) {
      const linkedActivities = await db
        .select({
          distanceMeters: activities.distanceMeters,
          durationSeconds: activities.durationSeconds,
          avgPaceSecondsPerKm: activities.avgPaceSecondsPerKm,
          avgHeartRate: activities.avgHeartRate,
        })
        .from(activities)
        .where(eq(activities.plannedWorkoutId, workoutId));

      linkedActivityCount = linkedActivities.length;

      if (linkedActivities.length > 0) {
        let totalDistance = 0;
        let totalDuration = 0;
        let weightedPaceSum = 0;
        let paceDistanceSum = 0;
        let hrSum = 0;
        let hrCount = 0;

        for (const act of linkedActivities) {
          const dist = act.distanceMeters ? parseFloat(act.distanceMeters) : 0;
          totalDistance += dist;
          totalDuration += act.durationSeconds;
          if (act.avgPaceSecondsPerKm && dist > 0) {
            weightedPaceSum += parseFloat(act.avgPaceSecondsPerKm) * dist;
            paceDistanceSum += dist;
          }
          if (act.avgHeartRate) {
            hrSum += act.avgHeartRate;
            hrCount++;
          }
        }

        completedActivity = {
          distanceMeters: totalDistance > 0 ? totalDistance : null,
          durationSeconds: totalDuration,
          avgPaceSecondsPerKm: paceDistanceSum > 0
            ? weightedPaceSum / paceDistanceSum
            : null,
          avgHeartRate: hrCount > 0 ? Math.round(hrSum / hrCount) : null,
        };
      }
    }

    return NextResponse.json({
      workout: {
        id: workout.id,
        scheduledDate: workout.scheduledDate,
        dayOfWeek: workout.dayOfWeek,
        workoutType: workout.workoutType,
        title: workout.title,
        description: workout.description,
        targetDistanceMeters: workout.targetDistanceMeters,
        targetDurationSeconds: workout.targetDurationSeconds,
        targetPaceMinPerKm: workout.targetPaceMinPerKm,
        targetHeartRateZone: workout.targetHeartRateZone,
        workoutSteps: workout.workoutSteps,
        syncStatus: workout.syncStatus,
        completionStatus: workout.completionStatus,
        skipReason: workout.skipReason,
        rpeScore: workout.rpeScore,
        perceivedDifficulty: workout.perceivedDifficulty,
        completedActivityId: workout.completedActivityId,
        completedActivity,
        linkedActivityCount,
        garminWorkoutId: workout.garminWorkoutId,
        sortOrder: workout.sortOrder,
        plan: {
          id: workout.plan.id,
          phase: workout.plan.phase,
          currentWeek: workout.plan.currentWeek,
          totalWeeks: workout.plan.totalWeeks,
          weeklyMileageTargetKm: workout.plan.weeklyMileageTargetKm,
        },
        goal: {
          id: workout.plan.goal.id,
          raceName: workout.plan.goal.raceName,
          raceDate: workout.plan.goal.raceDate,
          targetDistanceMeters: workout.plan.goal.targetDistanceMeters,
        },
      },
    });
  } catch (error) {
    console.error("Get workout error:", error);
    return NextResponse.json(
      { error: "Failed to fetch workout" },
      { status: 500 },
    );
  }
}
