"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { useRecentActivities, useActivePlan } from "@/lib/query/hooks";
import type { RecentActivity } from "@/lib/query/hooks";
import {
  useShoes,
  useShoeAssignments,
  useAssignActivityShoe,
  type Shoe,
} from "@/lib/query/shoe-hooks";
import {
  formatDistance,
  formatDuration,
  secPerKmToDisplay,
} from "@/lib/utils/pace";
import {
  classifyLoadFocus,
  computeLoadFocusDistribution,
  LOAD_FOCUS_CONFIG,
} from "@/lib/utils/training-focus";
import type { LoadFocusCategory } from "@/lib/utils/training-focus";

const TYPE_LABELS: Record<string, string> = {
  run: "Run",
  cycle: "Ride",
  swim: "Swim",
  walk: "Walk",
  hike: "Hike",
  yoga: "Yoga",
  strength: "Strength",
  padel: "Padel",
  kitesurf: "Kitesurf",
  hiit: "HIIT",
  snowboard: "Snowboard",
  other: "Activity",
};

const GARMIN_TYPE_MAP: Record<string, string> = {
  running: "run",
  trail_running: "run",
  treadmill_running: "run",
  track_running: "run",
  cycling: "cycle",
  mountain_biking: "cycle",
  indoor_cycling: "cycle",
  swimming: "swim",
  lap_swimming: "swim",
  open_water_swimming: "swim",
  strength_training: "strength",
  walking: "walk",
  hiking: "hike",
  yoga: "yoga",
  pilates: "yoga",
  paddelball: "padel",
  padel: "padel",
  hiit: "hiit",
  kitesurfing: "kitesurf",
  kite_surfing: "kitesurf",
  wind_kite_surfing: "kitesurf",
  resort_snowboarding: "snowboard",
  snowboarding: "snowboard",
  backcountry_snowboarding: "snowboard",
};

function getTypeLabel(type: string, garminType?: string | null): string {
  if (type !== "other" && TYPE_LABELS[type]) return TYPE_LABELS[type];

  if (garminType) {
    const key = garminType.toLowerCase().replace(/\s+/g, "_");
    const resolved = GARMIN_TYPE_MAP[key];
    if (resolved && TYPE_LABELS[resolved]) return TYPE_LABELS[resolved];

    return garminType
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  return TYPE_LABELS.other;
}

interface MetricItem {
  label: string;
  value: string;
  empty: boolean;
}

// Pace and distance only mean something for distance-covering sports; a padel
// match with a "pace" is sensor noise, not information.
const DISTANCE_SPORTS = new Set(["run", "walk", "hike", "cycling", "swim"]);

function isDistanceSport(a: RecentActivity): boolean {
  if (DISTANCE_SPORTS.has(a.type)) return true;
  const g = a.garminType?.toLowerCase() ?? "";
  return (
    ["running", "walking", "hiking", "cycling", "biking", "swimming"].some(
      (s) => g.includes(s),
    )
  );
}

function getUniversalMetrics(a: RecentActivity): MetricItem[] {
  const forDistance = isDistanceSport(a);
  const metrics: MetricItem[] = [];

  if (forDistance) {
    metrics.push({
      label: "Dist",
      value: a.distanceMeters ? formatDistance(a.distanceMeters) : "--",
      empty: !a.distanceMeters,
    });
    if (a.type === "run" || a.type === "walk" || a.type === "hike") {
      metrics.push({
        label: "Pace",
        value: a.avgPaceSecondsPerKm
          ? `${secPerKmToDisplay(a.avgPaceSecondsPerKm)}/km`
          : "--",
        empty: !a.avgPaceSecondsPerKm,
      });
    }
  }

  metrics.push(
    {
      label: "Time",
      value: formatDuration(a.durationSeconds),
      empty: false,
    },
    {
      label: "HR",
      value: a.avgHeartRate ? `${a.avgHeartRate}` : "--",
      empty: !a.avgHeartRate,
    },
    {
      label: "Cal",
      value: a.calories ? `${a.calories}` : "--",
      empty: !a.calories,
    },
  );

  return metrics;
}

type SummaryRange = "week" | "month" | "year";

export function RecentActivitiesFeed() {
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [summaryRange, setSummaryRange] = useState<SummaryRange>("month");

  const range = useMemo(() => {
    const { start, endDate } = getRangeCutoff(summaryRange);
    return { start: start.toISOString(), end: endDate.toISOString() };
  }, [summaryRange]);

  const { data, isLoading, error, refetch } = useRecentActivities(range);
  const { data: planData } = useActivePlan();
  const { data: shoesData } = useShoes();
  const { data: assignmentsData } = useShoeAssignments(range);

  // Shoe lookup maps for the per-run shoe chip (assignment is manual —
  // Garmin's partner API does not expose gear)
  const activeShoes = useMemo(
    () => (shoesData?.shoes ?? []).filter((s) => !s.retiredAt),
    [shoesData?.shoes]
  );
  const shoesById = useMemo(
    () => new Map((shoesData?.shoes ?? []).map((s) => [s.id, s])),
    [shoesData?.shoes]
  );
  const shoeIdByActivityId = useMemo(
    () =>
      new Map(
        (assignmentsData?.assignments ?? []).map((a) => [
          a.activityId,
          a.shoeId,
        ])
      ),
    [assignmentsData?.assignments]
  );
  // Most recently used active shoe — powers the one-tap "same as last run"
  const lastUsedShoe = useMemo(() => {
    let latest: Shoe | null = null;
    for (const s of activeShoes) {
      if (!s.lastUsedAt) continue;
      if (!latest || s.lastUsedAt > latest.lastUsedAt!) latest = s;
    }
    return latest;
  }, [activeShoes]);

  const handleRangeChange = (r: SummaryRange) => {
    setSummaryRange(r);
    setActiveFilter(null);
  };

  const rangeActivities = useMemo(() => data?.activities ?? [], [data?.activities]);

  const filterChips = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of rangeActivities) {
      counts.set(a.type, (counts.get(a.type) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({ type, count }));
  }, [rangeActivities]);

  const filteredActivities = activeFilter
    ? rangeActivities.filter((a) => a.type === activeFilter)
    : rangeActivities;

  return (
    <section className="flex min-h-full flex-col rounded-md border border-rule bg-paper-raised shadow-[0_1px_4px_rgba(38,36,31,0.06)]">
      <div className="flex items-center justify-between border-b border-rule px-5 py-3">
        <h2 className="text-sm font-semibold text-ink">
          Activity log
          {rangeActivities.length > 0 && (
            <span className="ml-2 font-mono text-xs font-normal tabular-nums text-ink-faint">
              {rangeActivities.length}
            </span>
          )}
        </h2>
        {!isLoading && (
          <RangeDropdown value={summaryRange} onChange={handleRangeChange} />
        )}
      </div>

      <div className="px-5 pb-4">
        {!isLoading && filterChips.length > 1 && (
          <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
            <FilterChip
              label="All"
              count={rangeActivities.length}
              active={activeFilter === null}
              onClick={() => setActiveFilter(null)}
            />
            {filterChips.map(({ type, count }) => (
              <FilterChip
                key={type}
                label={getTypeLabel(type)}
                count={count}
                active={activeFilter === type}
                onClick={() => setActiveFilter(activeFilter === type ? null : type)}
              />
            ))}
          </div>
        )}

        {!isLoading && filteredActivities.length > 0 && (
          <InlineSummary
            activities={filteredActivities}
            planData={planData}
            range={summaryRange}
          />
        )}

        {isLoading && (
          <div className="mt-3 divide-y divide-rule">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-4 py-3">
                <div className="skeleton h-3.5 w-16" />
                <div className="skeleton h-3.5 flex-1 max-w-40" />
                <div className="skeleton h-3.5 w-24" />
              </div>
            ))}
          </div>
        )}

        {error && !isLoading && (
          <div className="mt-4">
            <p className="text-sm text-pencil-red-deep">
              Couldn&apos;t load the activity log.
            </p>
            <button
              type="button"
              onClick={() => refetch()}
              className="mt-2 rounded border border-rule-strong px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:bg-paper-shade"
            >
              Try again
            </button>
          </div>
        )}

        {!isLoading && !error && rangeActivities.length === 0 && (
          <div className="mt-3">
            <div className="divide-y divide-rule">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-4 py-3">
                  <span className="w-16 text-xs text-ink-faint">&mdash;</span>
                  <span className="text-xs text-ink-faint">&mdash;</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-sm text-ink-soft">
              Nothing logged in this period. Sessions appear here once your
              watch syncs.
            </p>
          </div>
        )}

        {!isLoading && !error && rangeActivities.length > 0 && filteredActivities.length === 0 && (
          <p className="mt-4 border-t border-rule pt-4 text-sm text-ink-soft">
            No {getTypeLabel(activeFilter ?? "other").toLowerCase()} sessions
            in this period.
          </p>
        )}

        {!isLoading && filteredActivities.length > 0 && (
          <div className="mt-1 flex-1 divide-y divide-rule">
            {filteredActivities.map((activity) => (
              <ActivityRow
                key={activity.id}
                activity={activity}
                shoe={
                  shoesById.get(shoeIdByActivityId.get(activity.id) ?? "") ??
                  null
                }
                activeShoes={activeShoes}
                lastUsedShoe={lastUsedShoe}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex shrink-0 items-center gap-1 rounded border px-2.5 py-1 text-[11px] transition-colors duration-150 ${
        active
          ? "border-rule-strong bg-paper-shade font-semibold text-ink"
          : "border-rule font-medium text-ink-soft hover:bg-paper-shade"
      }`}
    >
      <span>{label}</span>
      <span className="font-mono tabular-nums text-ink-faint">{count}</span>
    </button>
  );
}

const RANGE_OPTIONS: { value: SummaryRange; label: string }[] = [
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "year", label: "This year" },
];

function getRangeCutoff(range: SummaryRange): { start: Date; endDate: Date } {
  const now = new Date();
  if (range === "year") {
    const start = new Date(now.getFullYear(), 0, 1);
    const endDate = new Date(now.getFullYear(), 11, 31);
    return { start, endDate };
  }
  if (range === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { start, endDate };
  }
  // week (Mon–Sun)
  const dayOfWeek = now.getDay();
  const start = new Date(now);
  start.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  start.setHours(0, 0, 0, 0);
  const endDate = new Date(start);
  endDate.setDate(start.getDate() + 6);
  return { start, endDate };
}

function InlineSummary({
  activities,
  planData,
  range,
}: {
  activities: RecentActivity[];
  planData?: {
    plan?: {
      workouts: {
        scheduledDate: string;
        completionStatus: string;
        workoutType: string;
      }[];
    };
  } | null;
  range: SummaryRange;
}) {
  const stats = useMemo(() => {
    const { start, endDate } = getRangeCutoff(range);
    const startDate = start.toISOString().split("T")[0];
    const endDateStr = endDate.toISOString().split("T")[0];

    const totalDistanceKm = activities.reduce(
      (sum, a) => sum + (a.distanceMeters ? a.distanceMeters / 1000 : 0),
      0
    );
    const totalDurationSec = activities.reduce(
      (sum, a) => sum + a.durationSeconds,
      0
    );

    // Rest days aren't workouts — exclude them from the planned tally
    const plannedInRange =
      planData?.plan?.workouts.filter(
        (w) =>
          w.scheduledDate >= startDate &&
          w.scheduledDate <= endDateStr &&
          w.workoutType !== "rest"
      ) ?? [];

    const completedCount = plannedInRange.filter(
      (w) => w.completionStatus === "completed"
    ).length;

    const focusDist = computeLoadFocusDistribution(activities);

    return {
      count: activities.length,
      totalDistanceKm,
      totalDurationSec,
      planned: plannedInRange.length,
      plannedCompleted: completedCount,
      focusDist,
    };
  }, [activities, planData, range]);

  if (stats.count === 0) return null;

  const hours = Math.floor(stats.totalDurationSec / 3600);
  const minutes = Math.floor((stats.totalDurationSec % 3600) / 60);
  const durationStr = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

  return (
    <div className="mt-3 border-b border-rule pb-3 text-xs text-ink-soft">
      <p>
        <span className="font-mono tabular-nums text-ink">{stats.count}</span>{" "}
        activities
        {stats.totalDistanceKm > 0 && (
          <>
            {" "}&middot;{" "}
            <span className="font-mono tabular-nums text-ink">
              {stats.totalDistanceKm.toFixed(1)} km
            </span>
          </>
        )}
        {" "}&middot;{" "}
        <span className="font-mono tabular-nums text-ink">{durationStr}</span>
        {stats.planned > 0 && (
          <>
            {" "}&middot;{" "}
            <span className="font-mono tabular-nums">
              {stats.plannedCompleted}/{stats.planned}
            </span>{" "}
            planned
          </>
        )}
      </p>
      {stats.focusDist.some(({ count }) => count > 0) && (
        <p className="mt-1 text-ink-faint">
          {stats.focusDist
            .filter(({ count }) => count > 0)
            .map(
              ({ category, count }) =>
                `${LOAD_FOCUS_CONFIG[category].shortLabel} ${count}`
            )
            .join(" · ")}
        </p>
      )}
    </div>
  );
}

function RangeDropdown({
  value,
  onChange,
}: {
  value: SummaryRange;
  onChange: (v: SummaryRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const current = RANGE_OPTIONS.find((o) => o.value === value)!;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-ink-soft transition-colors hover:bg-paper-shade hover:text-ink"
      >
        {current.label}
        <svg
          className={`h-2.5 w-2.5 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path d="M3 4.5l3 3 3-3" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[120px] rounded-md border border-rule bg-paper-raised py-1 shadow-[0_1px_4px_rgba(38,36,31,0.06)]">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className={`flex w-full items-center px-3 py-1.5 text-left text-xs transition-colors hover:bg-paper-shade ${
                opt.value === value
                  ? "font-semibold text-ink"
                  : "font-medium text-ink-soft"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ActivityRow({
  activity,
  shoe,
  activeShoes,
  lastUsedShoe,
}: {
  activity: RecentActivity;
  shoe: Shoe | null;
  activeShoes: Shoe[];
  lastUsedShoe: Shoe | null;
}) {
  const label = getTypeLabel(activity.type, activity.garminType);
  const metrics = getUniversalMetrics(activity);
  const isRun = label === "Run";

  const loadFocus: LoadFocusCategory | null =
    activity.trainingEffectAerobic !== null
      ? classifyLoadFocus(activity.trainingEffectAerobic, activity.trainingEffectAnaerobic)
      : null;

  return (
    <div className="flex items-center gap-4 py-2.5">
      <span className="w-16 shrink-0 font-mono text-xs tabular-nums text-ink-soft">
        {formatActivityDate(activity.startTime)}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-ink">
          {activity.name || label}
          {activity.wasPlanned && (
            <span className="ml-2 text-xs text-sage">plan</span>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-x-2 text-xs text-ink-faint">
          {activity.name &&
            activity.name.toLowerCase() !== label.toLowerCase() && (
              <span>{label}</span>
            )}
          {loadFocus && <span>{LOAD_FOCUS_CONFIG[loadFocus].shortLabel}</span>}
          {isRun && (shoe || activeShoes.length > 0) && (
            <ShoeChip
              activityId={activity.id}
              shoe={shoe}
              activeShoes={activeShoes}
              lastUsedShoe={lastUsedShoe}
            />
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-4">
        {metrics.map((metric, i) => (
          <div
            key={metric.label}
            className={
              i < 2
                ? undefined
                : i === 2
                  ? "hidden sm:block"
                  : i === 3
                    ? "hidden lg:block"
                    : "hidden xl:block"
            }
          >
            <MetricCell metric={metric} />
          </div>
        ))}
      </div>
    </div>
  );
}

function MetricCell({ metric }: { metric: MetricItem }) {
  return (
    <div className="w-16 text-right">
      <p
        className={`font-mono text-xs leading-tight tabular-nums ${
          metric.empty ? "text-ink-faint" : "text-ink"
        }`}
      >
        {metric.value}
      </p>
      <p className="text-[10px] leading-tight text-ink-faint">{metric.label}</p>
    </div>
  );
}

// Garmin's partner API does not expose gear, so shoe assignment is always a
// manual, explicit action — no silent default-shoe auto-assignment.
function ShoeChip({
  activityId,
  shoe,
  activeShoes,
  lastUsedShoe,
}: {
  activityId: string;
  shoe: Shoe | null;
  activeShoes: Shoe[];
  lastUsedShoe: Shoe | null;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const assign = useAssignActivityShoe();

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleAssign = (shoeId: string | null) => {
    setOpen(false);
    if (shoeId === (shoe?.id ?? null)) return;
    assign.mutate({ activityId, shoeId });
  };

  // One-tap "same as last run" — only when a previous run has a shoe and
  // this run isn't already wearing it
  const sameAsLast =
    lastUsedShoe && lastUsedShoe.id !== shoe?.id ? lastUsedShoe : null;

  return (
    <div className="relative inline-flex" ref={ref}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        className={`rounded border px-1.5 py-px text-[11px] font-medium text-ink-soft transition-colors hover:bg-paper-shade ${
          shoe ? "border-rule" : "border-dashed border-rule"
        } ${assign.isPending ? "opacity-50" : ""}`}
        title={shoe ? "Change shoe" : "Assign a shoe to this run"}
      >
        {shoe ? shoe.name : "+ shoe"}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-[160px] rounded-md border border-rule bg-paper-raised py-1 shadow-[0_1px_4px_rgba(38,36,31,0.06)]">
          {sameAsLast && (
            <>
              <button
                type="button"
                onClick={() => handleAssign(sameAsLast.id)}
                className="flex w-full flex-col items-start px-3 py-1.5 text-left transition-colors hover:bg-paper-shade"
              >
                <span className="text-[10px] font-medium uppercase tracking-wider text-ink-faint">
                  Same as last run
                </span>
                <span className="text-xs font-medium text-ink">
                  {sameAsLast.name}
                </span>
              </button>
              <div className="my-1 border-t border-rule" />
            </>
          )}
          {activeShoes.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => handleAssign(s.id)}
              className={`flex w-full items-center px-3 py-1.5 text-left text-xs transition-colors hover:bg-paper-shade ${
                s.id === shoe?.id
                  ? "font-semibold text-ink"
                  : "font-medium text-ink-soft"
              }`}
            >
              {s.name}
            </button>
          ))}
          {shoe && (
            <>
              <div className="my-1 border-t border-rule" />
              <button
                type="button"
                onClick={() => handleAssign(null)}
                className="flex w-full items-center px-3 py-1.5 text-left text-xs font-medium text-ink-soft transition-colors hover:bg-paper-shade hover:text-pencil-red-deep"
              >
                Remove shoe
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function formatActivityDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const actDay = new Date(date);
  actDay.setHours(0, 0, 0, 0);

  if (actDay.getTime() === today.getTime()) return "Today";
  if (actDay.getTime() === yesterday.getTime()) return "Yest";

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  });
}
