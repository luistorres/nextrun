import { addDays, format, parseISO } from "date-fns";
import type { getActivePlanWithWorkouts } from "@/lib/db/queries/training";
import type { TodayWorkout, TomorrowPreview } from "@/types/dashboard";

type PlanWithWorkouts = NonNullable<
  Awaited<ReturnType<typeof getActivePlanWithWorkouts>>
>;
export type PlannedWorkoutRow = PlanWithWorkouts["workouts"][number];

export function toTodayWorkout(w: PlannedWorkoutRow): TodayWorkout {
  return {
    id: w.id,
    workoutType: w.workoutType,
    title: w.title,
    description: w.description,
    targetDistanceMeters: w.targetDistanceMeters,
    targetDurationSeconds: w.targetDurationSeconds,
    targetPaceSecondsPerKm: w.targetPaceMinPerKm
      ? Math.round(Number(w.targetPaceMinPerKm) * 60)
      : null,
  };
}

export function buildTomorrowPreview(
  workouts: PlannedWorkoutRow[],
  today: string,
): TomorrowPreview | null {
  const tomorrow = format(addDays(parseISO(today), 1), "yyyy-MM-dd");
  const dayWorkouts = workouts.filter((w) => w.scheduledDate === tomorrow);
  const next =
    dayWorkouts.find((w) => w.workoutType !== "rest") ?? dayWorkouts[0] ?? null;
  if (!next) return null;
  return { ...toTodayWorkout(next), scheduledDate: next.scheduledDate };
}
