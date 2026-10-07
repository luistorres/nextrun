"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";

interface PlanWorkout {
  id: string;
  scheduledDate: string;
  dayOfWeek: string;
  workoutType: string;
  title: string;
  description: string | null;
  targetDistanceMeters: number | null;
}

interface Plan {
  id: string;
  phase: string;
  currentWeek: number;
  totalWeeks: number;
  weeklyMileageTargetKm: string;
  goal: {
    goalType: string;
    raceName: string | null;
    raceDate: string | null;
    targetDistanceMeters: number;
  };
  workouts: PlanWorkout[];
}

const WORKOUT_TYPE_LABELS: Record<string, string> = {
  easy_run: "Easy run",
  long_run: "Long run",
  tempo: "Tempo",
  intervals: "Intervals",
  recovery: "Recovery",
  fartlek: "Fartlek",
  hill_repeats: "Hill repeats",
  race_pace: "Race pace",
  rest: "Rest",
  cross_training: "Cross training",
};

function formatDistance(meters: number | null): string {
  if (!meters) return "";
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

interface PlanReadyStepProps {
  onComplete: () => void;
  isSubmitting: boolean;
  error: string | null;
}

export function PlanReadyStep({
  onComplete,
  isSubmitting,
  error,
}: PlanReadyStepProps) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchPlan() {
      try {
        const res = await fetch("/api/plan");
        if (res.ok) {
          const data = (await res.json()) as { plan: Plan };
          setPlan(data.plan);
        }
      } catch {
        // Plan fetch failed — show minimal state
      } finally {
        setIsLoading(false);
      }
    }
    fetchPlan();
  }, []);

  const firstWeekWorkouts = plan?.workouts.slice(0, 7) ?? [];

  if (isLoading) {
    return (
      <div className="space-y-4 py-6">
        <div className="skeleton h-8 w-48" />
        <div className="skeleton h-4 w-64" />
        <div className="mt-6 space-y-3">
          {[1, 2, 3].map((n) => (
            <div key={n} className="skeleton h-10 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-ink">Plan ready</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            {plan?.goal.raceName
              ? `Your training plan for ${plan.goal.raceName} is written.`
              : "Your training plan is written."}
          </p>
        </div>
        {plan && (
          <span className="stamp mt-1 shrink-0 text-[11px] text-sage">
            {plan.totalWeeks} weeks
          </span>
        )}
      </div>

      {plan && (
        <dl className="border-t border-rule">
          {[
            { label: "Duration", value: `${plan.totalWeeks} weeks` },
            { label: "Starting phase", value: plan.phase },
            {
              label: "Weekly target",
              value: `${Number(plan.weeklyMileageTargetKm).toFixed(0)} km`,
            },
            {
              label: "Goal distance",
              value: formatDistance(plan.goal.targetDistanceMeters),
            },
          ].map((row) => (
            <div
              key={row.label}
              className="flex items-baseline justify-between border-b border-rule py-2.5"
            >
              <dt className="text-sm text-ink-soft">{row.label}</dt>
              <dd className="font-mono text-sm capitalize tabular-nums text-ink">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {firstWeekWorkouts.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-ink">Week 1</h3>
          <div className="border-t border-rule">
            {firstWeekWorkouts.map((workout) => (
              <div
                key={workout.id}
                className="flex items-baseline gap-4 border-b border-rule py-2.5"
              >
                <span className="w-16 shrink-0 font-mono text-xs text-ink-faint">
                  {formatDate(workout.scheduledDate)}
                </span>
                <span className="w-20 shrink-0 text-xs text-ink-soft">
                  {WORKOUT_TYPE_LABELS[workout.workoutType] ??
                    workout.workoutType}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                  {workout.title}
                </span>
                {workout.targetDistanceMeters && (
                  <span className="shrink-0 font-mono text-xs tabular-nums text-ink-soft">
                    {formatDistance(workout.targetDistanceMeters)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-md bg-red-soft p-3">
          <p className="text-sm text-pencil-red-deep">{error}</p>
        </div>
      )}

      <div className="flex flex-col items-center gap-3 border-t border-rule pt-6">
        <Button
          variant="primary"
          size="lg"
          onClick={onComplete}
          loading={isSubmitting}
          className="w-full sm:w-auto"
        >
          Open your logbook
        </Button>
        <p className="text-xs text-ink-faint">
          The plan adapts weekly to your training and recovery data.
        </p>
      </div>
    </div>
  );
}
