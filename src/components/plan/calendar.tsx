"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

interface CalendarWorkout {
  id: string;
  scheduledDate: string;
  dayOfWeek: string;
  workoutType: string;
  title: string;
  targetDistanceMeters: number | null;
  targetDurationSeconds: number | null;
  completionStatus: string;
  completedActivityId?: string | null;
}

interface CalendarActivity {
  id: string;
  type: string;
  name: string | null;
  startTime: string;
  durationSeconds: number;
  distanceMeters: number | null;
  wasPlanned: boolean;
}

interface CalendarProps {
  workouts: CalendarWorkout[];
  activities?: CalendarActivity[];
  planStartDate: string;
  totalWeeks: number;
  currentWeek: number;
}

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
    "race",
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

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatShortDate(date: Date): string {
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function formatKm(meters: number): string {
  return meters >= 1000
    ? `${(meters / 1000).toFixed(1)} km`
    : `${Math.round(meters)} m`;
}

function formatActivityMetric(activity: CalendarActivity): string {
  if (
    activity.type === "run" &&
    activity.distanceMeters &&
    activity.distanceMeters >= 500
  ) {
    return formatKm(activity.distanceMeters);
  }
  if (activity.durationSeconds > 0) {
    const h = Math.floor(activity.durationSeconds / 3600);
    const m = Math.floor((activity.durationSeconds % 3600) / 60);
    if (h > 0) return `${h}h${m > 0 ? ` ${m}m` : ""}`;
    return `${m} min`;
  }
  if (activity.distanceMeters && activity.distanceMeters > 0) {
    return formatKm(activity.distanceMeters);
  }
  return "";
}

/**
 * Sum distance from all type-compatible activities on a day — handles split
 * sessions regardless of whether each activity was formally linked.
 */
function getAggregatedDistance(
  workout: CalendarWorkout,
  dayActivities: CalendarActivity[],
): number {
  return dayActivities
    .filter((a) => isCompatible(a.type, workout.workoutType))
    .reduce((sum, a) => sum + (a.distanceMeters ?? 0), 0);
}

interface DayData {
  date: Date;
  dateKey: string;
  workouts: CalendarWorkout[];
  activities: CalendarActivity[];
}

interface WeekData {
  weekNumber: number;
  weekMonday: Date;
  days: DayData[];
}

function weekHasContent(week: WeekData): boolean {
  return week.days.some(
    (d) => d.workouts.length > 0 || d.activities.length > 0,
  );
}

type WeekRenderItem =
  | { type: "week"; week: WeekData }
  | { type: "collapsed"; weeks: WeekData[] };

function buildWeekRenderItems(
  weeks: WeekData[],
  currentWeek: number,
): WeekRenderItem[] {
  const items: WeekRenderItem[] = [];
  let pending: WeekData[] = [];

  const flush = () => {
    if (pending.length > 0) {
      items.push({ type: "collapsed", weeks: pending });
      pending = [];
    }
  };

  for (const week of weeks) {
    if (week.weekNumber !== currentWeek && !weekHasContent(week)) {
      pending.push(week);
    } else {
      flush();
      items.push({ type: "week", week });
    }
  }
  flush();
  return items;
}

export function PlanCalendar({
  workouts,
  activities = [],
  planStartDate,
  totalWeeks,
  currentWeek,
}: CalendarProps) {
  const workoutsByDate = useMemo(() => {
    const map = new Map<string, CalendarWorkout[]>();
    for (const w of workouts) {
      const existing = map.get(w.scheduledDate) ?? [];
      existing.push(w);
      map.set(w.scheduledDate, existing);
    }
    return map;
  }, [workouts]);

  const activitiesByDate = useMemo(() => {
    const map = new Map<string, CalendarActivity[]>();
    for (const a of activities) {
      const dateKey = formatDateKey(new Date(a.startTime));
      const existing = map.get(dateKey) ?? [];
      existing.push(a);
      map.set(dateKey, existing);
    }
    return map;
  }, [activities]);

  const weeks = useMemo(() => {
    const startDate = new Date(planStartDate + "T00:00:00");
    const planMonday = getMondayOfWeek(startDate);

    // When the first workout falls mid-week the calendar starts earlier than
    // the plan's own week count, so an extra week may be needed to reach race day.
    let weeksNeeded = totalWeeks;
    if (workouts.length > 0) {
      const lastWorkoutDate = new Date(
        workouts[workouts.length - 1].scheduledDate + "T00:00:00",
      );
      const lastSunday = addDays(getMondayOfWeek(lastWorkoutDate), 6);
      const msSpan = lastSunday.getTime() - planMonday.getTime();
      const spannedWeeks = Math.ceil(msSpan / (7 * 24 * 60 * 60 * 1000));
      weeksNeeded = Math.max(totalWeeks, spannedWeeks);
    }

    return Array.from({ length: weeksNeeded }, (_, i) => {
      const weekMonday = addDays(planMonday, i * 7);
      const days = Array.from({ length: 7 }, (_, d) => {
        const date = addDays(weekMonday, d);
        const dateKey = formatDateKey(date);
        return {
          date,
          dateKey,
          workouts: workoutsByDate.get(dateKey) ?? [],
          activities: activitiesByDate.get(dateKey) ?? [],
        };
      });
      return { weekNumber: i + 1, weekMonday, days };
    });
  }, [planStartDate, totalWeeks, workouts, workoutsByDate, activitiesByDate]);

  const today = formatDateKey(new Date());
  const renderItems = buildWeekRenderItems(weeks, currentWeek);

  return (
    <div>
      {renderItems.map((item) =>
        item.type === "collapsed" ? (
          <CollapsedWeeksRow
            key={`collapsed-${item.weeks[0].weekNumber}`}
            weeks={item.weeks}
          />
        ) : (
          <WeekSection
            key={item.week.weekNumber}
            week={item.week}
            currentWeek={currentWeek}
            today={today}
          />
        ),
      )}
    </div>
  );
}

function CollapsedWeeksRow({ weeks }: { weeks: WeekData[] }) {
  const first = weeks[0];
  const last = weeks[weeks.length - 1];
  const label =
    first.weekNumber === last.weekNumber
      ? `Week ${first.weekNumber}`
      : `Weeks ${first.weekNumber}–${last.weekNumber}`;

  return (
    <div className="border-t border-rule px-4 py-3 sm:px-5">
      <p className="text-xs text-ink-faint">
        {label} · {formatShortDate(first.weekMonday)} –{" "}
        {formatShortDate(addDays(last.weekMonday, 6))} · written at your weekly
        review
      </p>
    </div>
  );
}

function weekSummary(week: WeekData, isPast: boolean, today: string) {
  const runWorkouts = week.days.flatMap((d) =>
    d.workouts.filter((w) => w.workoutType !== "rest"),
  );
  const plannedMeters = runWorkouts.reduce(
    (sum, w) => sum + (w.targetDistanceMeters ?? 0),
    0,
  );

  let done = 0;
  for (const day of week.days) {
    for (const w of day.workouts) {
      if (w.workoutType === "rest") continue;
      if (
        w.completionStatus === "completed" ||
        getAggregatedDistance(w, day.activities) > 0
      ) {
        done++;
      }
    }
  }

  const parts: string[] = [];
  if (plannedMeters > 0) parts.push(formatKm(plannedMeters));
  if (runWorkouts.length > 0) {
    parts.push(
      isPast || today >= formatDateKey(week.weekMonday)
        ? `${done} of ${runWorkouts.length} done`
        : `${runWorkouts.length} runs`,
    );
  }
  return parts.join(" · ");
}

function WeekSection({
  week,
  currentWeek,
  today,
}: {
  week: WeekData;
  currentWeek: number;
  today: string;
}) {
  const isCurrent = week.weekNumber === currentWeek;
  const isPast = week.weekNumber < currentWeek;
  const [open, setOpen] = useState(isCurrent);

  const dateRange = `${formatShortDate(week.weekMonday)} – ${formatShortDate(addDays(week.weekMonday, 6))}`;
  const summary = weekSummary(week, isPast, today);

  const days = isCurrent
    ? week.days
    : week.days.filter(
        (d) => d.workouts.length > 0 || d.activities.length > 0,
      );

  return (
    <section className="border-t border-rule first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={`flex w-full items-baseline gap-2 px-4 py-3 text-left transition-colors hover:bg-paper-shade sm:px-5 ${
          isCurrent ? "bg-paper-shade/60" : ""
        }`}
      >
        <span
          className={`text-sm font-semibold ${isCurrent ? "text-ink" : "text-ink-soft"}`}
        >
          Week {week.weekNumber}
        </span>
        <span className="text-xs text-ink-faint">{dateRange}</span>
        {summary && (
          <span className="ml-auto shrink-0 font-mono text-xs tabular-nums text-ink-soft">
            {summary}
          </span>
        )}
        {isCurrent && (
          <span className="stamp shrink-0 text-[10px] text-pencil-red">
            This week
          </span>
        )}
      </button>

      {open &&
        (days.length === 0 ? (
          <EmptyWeekRows weekNumber={week.weekNumber} />
        ) : (
          <div>
            {days.map((day) => (
              <DayRows
                key={day.dateKey}
                day={day}
                dayLabel={
                  DAY_LABELS[day.date.getDay() === 0 ? 6 : day.date.getDay() - 1]
                }
                today={today}
              />
            ))}
          </div>
        ))}
    </section>
  );
}

function EmptyWeekRows({ weekNumber }: { weekNumber: number }) {
  return (
    <div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="border-t border-rule px-4 py-2.5 sm:px-5">
          <div className="h-4 w-2/5 rounded-sm bg-paper-shade" />
        </div>
      ))}
      <p className="border-t border-rule px-4 py-2.5 text-xs text-ink-faint sm:px-5">
        Week {weekNumber} gets written at your weekly review.
      </p>
    </div>
  );
}

function DayRows({
  day,
  dayLabel,
  today,
}: {
  day: DayData;
  dayLabel: string;
  today: string;
}) {
  const isToday = day.dateKey === today;
  const isPast = day.dateKey < today;

  const workoutTypes = day.workouts.map((w) => w.workoutType);
  const extras = day.activities.filter(
    (a) => !workoutTypes.some((wt) => isCompatible(a.type, wt)),
  );

  if (day.workouts.length === 0 && extras.length === 0) {
    return (
      <div
        className={`flex items-baseline gap-3 border-t border-rule px-4 py-2.5 sm:px-5 ${
          isToday ? "border-l-2 border-l-pencil-red" : ""
        }`}
      >
        <span className="w-9 shrink-0 text-xs font-semibold text-ink-faint">
          {dayLabel}
        </span>
        <span className="text-xs italic text-ink-faint">Rest</span>
      </div>
    );
  }

  return (
    <>
      {day.workouts.map((w, i) => (
        <WorkoutRow
          key={w.id}
          workout={w}
          dayLabel={i === 0 ? dayLabel : ""}
          isToday={isToday}
          isPast={isPast}
          dayActivities={day.activities}
        />
      ))}
      {extras.map((a, i) => (
        <ActivityRow
          key={a.id}
          activity={a}
          dayLabel={day.workouts.length === 0 && i === 0 ? dayLabel : ""}
          isToday={isToday}
        />
      ))}
    </>
  );
}

function WorkoutRow({
  workout,
  dayLabel,
  isToday,
  isPast,
  dayActivities,
}: {
  workout: CalendarWorkout;
  dayLabel: string;
  isToday: boolean;
  isPast: boolean;
  dayActivities: CalendarActivity[];
}) {
  const isRest = workout.workoutType === "rest";
  const aggregated = getAggregatedDistance(workout, dayActivities);
  const done = workout.completionStatus === "completed" || aggregated > 0;

  let status: React.ReactNode = null;
  if (!isRest) {
    if (done) {
      status = (
        <svg
          className="pencil-check h-3.5 w-3.5 shrink-0 text-sage"
          viewBox="0 0 24 24"
          fill="none"
          aria-label="Done"
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
    } else if (workout.completionStatus === "partial") {
      status = <span className="text-[11px] text-amber-pencil">partial</span>;
    } else if (
      workout.completionStatus === "skipped" ||
      (isPast && dayActivities.length === 0)
    ) {
      status = <span className="text-[11px] text-amber-pencil">skipped</span>;
    }
  }

  const metric =
    done && aggregated > 0
      ? formatKm(aggregated)
      : workout.targetDistanceMeters
        ? formatKm(workout.targetDistanceMeters)
        : workout.targetDurationSeconds
          ? `${Math.round(workout.targetDurationSeconds / 60)} min`
          : null;

  return (
    <Link
      href={`/dashboard/plan/workout/${workout.id}`}
      className={`flex items-baseline gap-3 border-t border-rule px-4 py-2.5 transition-colors hover:bg-paper-shade sm:px-5 ${
        isToday ? "border-l-2 border-l-pencil-red" : ""
      }`}
    >
      <span className="w-9 shrink-0 text-xs font-semibold text-ink-faint">
        {dayLabel}
      </span>
      <span
        className={`min-w-0 flex-1 truncate text-sm ${
          isRest
            ? "italic text-ink-faint"
            : isToday
              ? "font-semibold text-ink"
              : "text-ink"
        }`}
      >
        {workout.title}
      </span>
      {!isRest && metric && (
        <span className="shrink-0 font-mono text-xs tabular-nums text-ink-soft">
          {metric}
        </span>
      )}
      <span className="flex w-11 shrink-0 justify-end self-center">{status}</span>
    </Link>
  );
}

function ActivityRow({
  activity,
  dayLabel,
  isToday,
}: {
  activity: CalendarActivity;
  dayLabel: string;
  isToday: boolean;
}) {
  const label = ACTIVITY_LABELS[activity.type] ?? "Activity";
  const showName =
    activity.name &&
    activity.name.toLowerCase() !== label.toLowerCase() &&
    activity.name.toLowerCase() !== activity.type.toLowerCase();
  const metric = formatActivityMetric(activity);

  return (
    <div
      className={`flex items-baseline gap-3 border-t border-rule px-4 py-2.5 sm:px-5 ${
        isToday ? "border-l-2 border-l-pencil-red" : ""
      }`}
    >
      <span className="w-9 shrink-0 text-xs font-semibold text-ink-faint">
        {dayLabel}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-ink-soft">
        {showName ? activity.name : label}
        <span className="ml-2 text-xs text-ink-faint">unplanned</span>
      </span>
      {metric && (
        <span className="shrink-0 font-mono text-xs tabular-nums text-ink-soft">
          {metric}
        </span>
      )}
      <span className="w-11 shrink-0" />
    </div>
  );
}
