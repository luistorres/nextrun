"use client";

import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { ChartContainer } from "@/components/charts/chart-container";
import type { RecentActivity } from "@/lib/query/hooks";

// ---------------------------------------------------------------------------
// Activity categories & classification
// ---------------------------------------------------------------------------

interface ActivityCategory {
  key: string;
  label: string;
  color: string;
}

const CATEGORIES: ActivityCategory[] = [
  { key: "running", label: "Running", color: "#2F6B45" },
  { key: "cycling", label: "Cycling", color: "#545A62" },
  { key: "swimming", label: "Swimming", color: "#A8B8C9" },
  { key: "walking", label: "Walk / Hike", color: "#96691D" },
  { key: "snow", label: "Snow", color: "#848B94" },
  { key: "gym", label: "Gym", color: "#22252A" },
  { key: "other", label: "Other", color: "#CCD6E2" },
];

// Primary: maps the normalized DB `activityType` values
const DB_TYPE_MAP: Record<string, string> = {
  run: "running",
  cycle: "cycling",
  swim: "swimming",
  walk: "walking",
  hike: "walking",
  strength: "gym",
  yoga: "gym",
  hiit: "gym",
  padel: "other",
  kitesurf: "other",
};

// Secondary: maps garminType (rawJson.activityType.typeKey) for "other" DB entries
const GARMIN_TYPE_MAP: Record<string, string> = {
  resort_skiing_snowboarding: "snow",
  snowboarding: "snow",
  backcountry_skiing_snowboarding: "snow",
  cross_country_skiing: "snow",
  skate_skiing: "snow",
  skiing: "snow",
  resort_skiing: "snow",
  alpine_skiing: "snow",
  snow_shoe: "snow",
  snowshoeing: "snow",
};

function classify(type: string, garminType: string | null): string {
  const primary = DB_TYPE_MAP[type];
  if (primary) return primary;

  if (garminType) {
    const key = garminType.toLowerCase().replace(/[\s-]+/g, "_");
    const secondary = GARMIN_TYPE_MAP[key];
    if (secondary) return secondary;
  }

  return "other";
}

// ---------------------------------------------------------------------------
// Weekly bucket builder
// ---------------------------------------------------------------------------

type WeekBucket = {
  week: string;
  sortKey: string;
  total: number;
  totalMin: number;
  count: number;
  [k: string]: string | number;
};

function buildWeeks(
  activities: RecentActivity[],
  active: Set<string>
): WeekBucket[] {
  const map = new Map<string, WeekBucket>();

  for (const a of activities) {
    const cat = classify(a.type, a.garminType);
    if (!active.has(cat)) continue;

    const d = new Date(a.startTime);
    const ws = weekStart(d);
    const key = ws.toISOString().split("T")[0];
    const km = a.distanceMeters ? a.distanceMeters / 1000 : 0;
    const min = a.durationSeconds / 60;

    let b = map.get(key);
    if (!b) {
      b = { week: fmtWeek(ws), sortKey: key, total: 0, totalMin: 0, count: 0 };
      for (const c of active) b[c] = 0;
      map.set(key, b);
    }
    b.total += km;
    b.totalMin += min;
    b.count += 1;
    b[cat] = ((b[cat] as number) || 0) + km;
  }

  return [...map.values()].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

function weekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

function fmtWeek(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface TrainingLoadChartProps {
  activities: RecentActivity[];
}

export function TrainingLoadChart({ activities }: TrainingLoadChartProps) {
  // Which categories actually contributed distance
  const present = useMemo(() => {
    const km = new Map<string, number>();
    for (const a of activities) {
      const cat = classify(a.type, a.garminType);
      const d = a.distanceMeters ? a.distanceMeters / 1000 : 0;
      km.set(cat, (km.get(cat) || 0) + d);
    }
    return CATEGORIES.filter((c) => (km.get(c.key) || 0) > 0);
  }, [activities]);

  // Track disabled categories — anything not disabled is active.
  // This way new categories automatically show when data changes.
  const [disabled, setDisabled] = useState<Set<string>>(new Set());

  const active = useMemo(
    () =>
      new Set(
        present.filter((c) => !disabled.has(c.key)).map((c) => c.key)
      ),
    [present, disabled]
  );

  const weeks = useMemo(
    () => buildWeeks(activities, active),
    [activities, active]
  );

  const totalKm = weeks.reduce((s, w) => s + w.total, 0);
  const totalCount = weeks.reduce((s, w) => s + w.count, 0);
  const avgPerWeek = weeks.length > 0 ? totalKm / weeks.length : 0;

  const toggle = (key: string) => {
    setDisabled((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else if (active.size > 1) {
        next.add(key);
      }
      return next;
    });
  };

  const showAll = () => setDisabled(new Set());

  if (activities.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-md border border-dashed border-rule bg-paper">
        <p className="px-6 text-center text-sm text-ink-faint">
          No activities yet — your weeks fill in as runs sync.
        </p>
      </div>
    );
  }

  const orderedActive = CATEGORIES.filter((c) => active.has(c.key));

  return (
    <div className="space-y-5">
      {/* Stats row + filter pills */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-baseline gap-6">
          <Stat value={totalKm.toFixed(0)} unit="km" size="lg" />
          <Stat value={totalCount.toString()} unit="activities" />
          <Stat value={avgPerWeek.toFixed(1)} unit="km/wk" />
        </div>

        {present.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            <Pill
              label="All"
              active={active.size === present.length}
              onClick={showAll}
            />
            {present.map((cat) => (
              <Pill
                key={cat.key}
                label={cat.label}
                color={cat.color}
                active={active.has(cat.key)}
                onClick={() => toggle(cat.key)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Stacked bar chart */}
      <ChartContainer height={288}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 480, height: 288 }}>
          <BarChart
            data={weeks}
            margin={{ top: 8, right: 12, bottom: 0, left: -12 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#CCD6E2"
              strokeWidth={0.5}
              vertical={false}
            />
            <XAxis
              dataKey="week"
              tick={{ fontSize: 11, fill: "#848B94", fontFamily: "var(--font-data), monospace" }}
              stroke="#CCD6E2"
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#848B94", fontFamily: "var(--font-data), monospace" }}
              stroke="#CCD6E2"
              unit=" km"
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              cursor={{ fill: "rgba(34,37,42,0.04)" }}
              content={<WeekTooltip orderedActive={orderedActive} />}
            />
            {orderedActive.map((cat, i) => (
              <Bar
                key={cat.key}
                dataKey={cat.key}
                stackId="vol"
                fill={cat.color}
                radius={
                  i === orderedActive.length - 1 ? [3, 3, 0, 0] : undefined
                }
                maxBarSize={52}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </ChartContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

function WeekTooltip({
  active: isActive,
  payload,
  label,
  orderedActive,
}: {
  active?: boolean;
  payload?: Array<{ payload: WeekBucket }>;
  label?: string;
  orderedActive: ActivityCategory[];
}) {
  if (!isActive || !payload?.length) return null;
  const bucket = payload[0].payload;

  return (
    <div className="rounded-md border border-rule bg-paper-raised px-3.5 py-3 shadow-[0_1px_4px_rgba(38,36,31,0.06)]">
      <p className="text-xs text-ink-faint">Week of {label}</p>
      <p className="mt-1.5 font-mono text-lg font-semibold leading-none text-ink tabular-nums">
        {bucket.total.toFixed(1)}{" "}
        <span className="font-sans text-xs font-normal text-ink-faint">km</span>
      </p>
      <p className="mt-0.5 font-mono text-[11px] text-ink-soft tabular-nums">
        {bucket.count} activities &middot; {bucket.totalMin.toFixed(0)} min
      </p>

      {orderedActive.length > 1 && (
        <div className="mt-2.5 space-y-1.5 border-t border-rule pt-2.5">
          {orderedActive.map((cat) => {
            const val = (bucket[cat.key] as number) || 0;
            if (val === 0) return null;
            const pct =
              bucket.total > 0 ? (val / bucket.total) * 100 : 0;
            return (
              <div
                key={cat.key}
                className="flex items-center justify-between gap-6"
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: cat.color }}
                  />
                  <span className="text-[11px] text-ink-soft">{cat.label}</span>
                </div>
                <span className="font-mono text-[11px] font-medium text-ink tabular-nums">
                  {val.toFixed(1)} km
                  <span className="ml-1.5 font-normal text-ink-faint">
                    {pct.toFixed(0)}%
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Stat({
  value,
  unit,
  size = "md",
}: {
  value: string;
  unit: string;
  size?: "md" | "lg";
}) {
  return (
    <div>
      <span
        className={`font-mono font-semibold text-ink tabular-nums ${
          size === "lg" ? "text-2xl" : "text-base"
        }`}
      >
        {value}
      </span>
      <span className="ml-1 text-[11px] text-ink-faint">{unit}</span>
    </div>
  );
}

function Pill({
  label,
  color,
  active,
  onClick,
}: {
  label: string;
  color?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded border px-2.5 py-1 text-[11px] font-medium transition-colors ${
        active
          ? "border-rule-strong bg-paper-shade text-ink"
          : "border-rule text-ink-faint hover:text-ink-soft"
      }`}
    >
      {color && (
        <span
          className="inline-block h-1.5 w-1.5 rounded-full transition-opacity"
          style={{
            background: color,
            opacity: active ? 1 : 0.35,
          }}
        />
      )}
      {label}
    </button>
  );
}
