"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useActivePlan, useRecentActivities } from "@/lib/query/hooks";
import type { PlanWorkout, RecentActivity } from "@/lib/query/hooks";
import { computeExecution } from "@/components/plan/execution-quality";

// Client-side copy from activity-matcher
const COMPATIBLE_TYPES: Record<string, string[]> = {
  run: [
    "easy_run",
    "long_run",
    "tempo",
    "intervals",
    "recovery",
    "fartlek",
    "hill_repeats",
    "race_pace",
  ],
  cycle: ["cross_training"],
  swim: ["cross_training"],
  walk: ["recovery", "cross_training"],
  hike: ["cross_training"],
  strength: ["cross_training"],
  yoga: ["cross_training", "recovery"],
  other: ["cross_training"],
};

function isCompatible(activityType: string, workoutType: string): boolean {
  const compatible = COMPATIBLE_TYPES[activityType];
  return compatible ? compatible.includes(workoutType) : false;
}

const ACTIVITY_LABELS: Record<string, string> = {
  run: "Run",
  cycle: "Ride",
  swim: "Swim",
  walk: "Walk",
  hike: "Hike",
  strength: "Strength",
  yoga: "Yoga",
  padel: "Padel",
  hiit: "HIIT",
  kitesurf: "Kitesurf",
  other: "Activity",
};

type DayState =
  | "upcoming"
  | "completed"
  | "missed"
  | "substituted"
  | "unplanned"
  | "rest";

interface DayData {
  date: Date;
  dateKey: string;
  dayLabel: string;
  isToday: boolean;
  isPast: boolean;
  state: DayState;
  workout: PlanWorkout | null;
  activity: RecentActivity | null;
}

const DAY_LABELS_FULL = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatKm(meters: number | null | undefined): string | null {
  if (!meters) return null;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function WeekAtAGlance() {
  const { data: planData, isLoading: planLoading } = useActivePlan();
  const { data: activityData, isLoading: activityLoading } =
    useRecentActivities();

  const isLoading = planLoading || activityLoading;
  const plan = planData?.plan ?? null;
  const activities = useMemo(() => activityData?.activities ?? [], [activityData?.activities]);

  const days = useMemo(() => {
    const now = new Date();
    const todayKey = formatDateKey(now);
    const monday = getMondayOfWeek(now);

    const workoutsByDate = new Map<string, PlanWorkout>();
    if (plan?.workouts) {
      for (const w of plan.workouts) {
        // Only keep first workout per day (primary)
        if (!workoutsByDate.has(w.scheduledDate)) {
          workoutsByDate.set(w.scheduledDate, w);
        }
      }
    }

    const activitiesByDate = new Map<string, RecentActivity>();
    for (const a of activities) {
      const aDate = formatDateKey(new Date(a.startTime));
      if (!activitiesByDate.has(aDate)) {
        activitiesByDate.set(aDate, a);
      }
    }

    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + i);
      const dateKey = formatDateKey(date);
      const isToday = dateKey === todayKey;
      const isPast = dateKey < todayKey;

      const workout = workoutsByDate.get(dateKey) ?? null;
      const activity = activitiesByDate.get(dateKey) ?? null;

      let state: DayState = "rest";

      if (workout && activity) {
        const compatible = isCompatible(activity.type, workout.workoutType);
        if (compatible || workout.completionStatus === "completed") {
          state = "completed";
        } else {
          state = "substituted";
        }
      } else if (workout && !activity) {
        if (isPast) {
          // Rest days can never be "missed" — no alarm markers for them
          if (workout.workoutType === "rest") {
            state = "rest";
          } else {
            state =
              workout.completionStatus === "completed" ? "completed" : "missed";
          }
        } else {
          state = "upcoming";
        }
      } else if (!workout && activity) {
        state = "unplanned";
      }

      return {
        date,
        dateKey,
        dayLabel: DAY_LABELS_FULL[i],
        isToday,
        isPast,
        state,
        workout,
        activity,
      } satisfies DayData;
    });
  }, [plan, activities]);

  const stats = useMemo(() => {
    // Rest days aren't workouts — don't count them toward the weekly tally
    const planned = days.filter(
      (d) => d.workout && d.workout.workoutType !== "rest",
    ).length;
    const completed = days.filter((d) => d.state === "completed").length;
    let kmThisWeek = 0;
    let unplannedKm = 0;
    for (const d of days) {
      const km = d.activity?.distanceMeters
        ? d.activity.distanceMeters / 1000
        : 0;
      kmThisWeek += km;
      if (km > 0 && (d.state === "unplanned" || d.state === "substituted")) {
        unplannedKm += km;
      }
    }

    const KEY_TYPES = new Set(["long_run", "tempo", "intervals", "hill_repeats", "race_pace"]);
    const worstKeyExec = days
      .filter((d) => d.state === "completed" && d.workout && KEY_TYPES.has(d.workout.workoutType) && d.isPast)
      .map((d) => computeExecution(d.workout!.targetDistanceMeters, d.activity?.distanceMeters ?? null))
      .filter(Boolean)
      .sort((a, b) => a!.ratio - b!.ratio)[0] ?? null;

    return { planned, completed, kmThisWeek, unplannedKm, worstKeyExec };
  }, [days]);

  if (isLoading) {
    return (
      <section className="rounded-md border border-rule bg-paper-raised">
        <div className="flex items-center justify-between border-b border-rule px-5 py-3">
          <div className="skeleton h-4 w-24" />
          <div className="skeleton h-4 w-16" />
        </div>
        <div className="divide-y divide-rule px-5">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="flex items-center gap-4 py-2.5">
              <div className="skeleton h-4 w-14" />
              <div className="skeleton h-4 flex-1 max-w-48" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (!plan) {
    return (
      <section className="rounded-md border border-rule bg-paper-raised">
        <div className="border-b border-rule px-5 py-3">
          <h2 className="text-sm font-semibold text-ink">This week</h2>
        </div>
        <div className="divide-y divide-rule px-5">
          {DAY_LABELS_FULL.map((label) => (
            <div key={label} className="flex items-center gap-4 py-2.5">
              <span className="w-14 text-xs font-medium uppercase tracking-wide text-ink-faint">
                {label}
              </span>
              <span className="text-sm text-ink-faint">&mdash;</span>
            </div>
          ))}
        </div>
        <div className="border-t border-rule px-5 py-3">
          <p className="text-sm text-ink-soft">
            No plan yet.{" "}
            <Link
              href="/dashboard/onboarding"
              className="font-medium text-pencil-red underline underline-offset-2 hover:text-pencil-red-deep"
            >
              Start one
            </Link>{" "}
            and this page fills itself in.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-md border border-rule bg-paper-raised shadow-[0_1px_4px_rgba(38,36,31,0.06)]">
      <div className="flex items-center justify-between border-b border-rule px-5 py-3">
        <h2 className="text-sm font-semibold text-ink">This week</h2>
        <Link
          href="/dashboard/plan"
          className="text-xs font-medium text-ink-soft underline-offset-2 transition-colors hover:text-ink hover:underline"
        >
          <span className="font-mono tabular-nums">
            Week {plan.currentWeek}/{plan.totalWeeks}
          </span>{" "}
          &rarr;
        </Link>
      </div>

      <div className="divide-y divide-rule px-5">
        {days.map((day) => {
          const todayIndex = days.findIndex((d) => d.isToday);
          const index = days.indexOf(day);
          const stepsAhead = todayIndex >= 0 ? index - todayIndex : 0;
          // The contract's first viewport: days beyond today fade down the page
          const opacity =
            stepsAhead <= 0 ? 1 : Math.max(0.45, 1 - stepsAhead * 0.12);
          return (
            <div key={day.dateKey} style={opacity < 1 ? { opacity } : undefined}>
              <DayRow day={day} />
            </div>
          );
        })}
      </div>

      {stats.planned > 0 && (
        <div className="border-t border-rule px-5 py-2.5">
          <p className="text-xs text-ink-soft">
            <span className="font-mono tabular-nums text-ink">
              {stats.completed}/{stats.planned}
            </span>{" "}
            completed
            {stats.kmThisWeek > 0 && (
              <>
                {" "}&middot;{" "}
                <span className="font-mono tabular-nums text-ink">
                  {stats.kmThisWeek.toFixed(1)} km
                </span>
                {stats.unplannedKm > 0 &&
                  ` incl. ${stats.unplannedKm.toFixed(1)} km unplanned`}
              </>
            )}
          </p>
          {stats.worstKeyExec && (stats.worstKeyExec.label === "partial" || stats.worstKeyExec.label === "minimal") && (
            <p className="mt-1 text-xs text-amber-pencil">
              A key session came up short ({stats.worstKeyExec.pct}). Your
              coach is factoring it in.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function DayRow({ day }: { day: DayData }) {
  const { isToday, state, workout, activity } = day;

  const title =
    workout && state !== "unplanned"
      ? workout.title
      : activity
        ? (activity.name ?? ACTIVITY_LABELS[activity.type] ?? "Activity")
        : "Rest";

  const distance =
    state === "completed" || state === "substituted" || state === "unplanned"
      ? formatKm(activity?.distanceMeters)
      : formatKm(workout?.targetDistanceMeters);

  return (
    <div className="flex min-h-[44px] items-center gap-4 py-2">
      <div className="flex w-14 shrink-0 items-baseline gap-1.5">
        <span
          className={`text-xs uppercase tracking-wide ${
            isToday ? "font-semibold text-ink" : "font-medium text-ink-faint"
          }`}
        >
          {day.dayLabel}
        </span>
        <span
          className={`font-mono text-xs tabular-nums ${
            isToday ? "font-bold text-pencil-red" : "text-ink-faint"
          }`}
        >
          {day.date.getDate()}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <p
          className={`truncate text-sm ${
            state === "rest"
              ? "text-ink-faint"
              : isToday
                ? "font-semibold text-ink"
                : "text-ink"
          }`}
        >
          {title}
          {state === "substituted" && (
            <span className="ml-2 text-xs text-ink-soft">
              swapped for {ACTIVITY_LABELS[activity!.type] ?? "activity"}
            </span>
          )}
          {state === "unplanned" && (
            <span className="ml-2 text-xs text-ink-soft">unplanned</span>
          )}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {distance && state !== "rest" && (
          <span className="font-mono text-xs tabular-nums text-ink-soft">
            {distance}
          </span>
        )}
        {state === "completed" && <DoneTick />}
        {state === "missed" && (
          <span className="text-xs text-amber-pencil">missed</span>
        )}
        {state === "rest" && <span className="text-xs text-ink-faint">&mdash;</span>}
      </div>
    </div>
  );
}

function DoneTick() {
  return (
    <svg
      className="pencil-check h-4 w-4 text-sage"
      viewBox="0 0 24 24"
      fill="none"
      aria-label="Completed"
    >
      <path
        d="M5 12.5l4.2 4.8L19 6.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
