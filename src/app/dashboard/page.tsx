"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  useMetricsSummary,
  useDashboardToday,
  useFitnessProfile,
  useMetricsTrends,
  useActivePlan,
  useRecentActivities,
} from "@/lib/query/hooks";
import { RecentActivitiesFeed } from "@/components/dashboard/recent-activities";
import { WeekAtAGlance } from "@/components/dashboard/week-at-a-glance";
import { PendingAdaptationBanner } from "@/components/dashboard/pending-adaptation-banner";
import { DailyCheckin } from "@/components/dashboard/daily-checkin";
import { TodayHero, CoachHeartbeat } from "@/components/dashboard/today-hero";

export default function DashboardPage() {
  return (
    <div className="mx-auto flex min-h-full max-w-4xl flex-col gap-5">
      <h1 className="sr-only">Today</h1>
      <PendingAdaptationBanner />
      <TodayHero />
      <CoachHeartbeat />
      <DailyCheckin />
      <WeekAtAGlance />
      <MarginFigures />
      <ProgressLine />
      <div className="flex-1">
        <RecentActivitiesFeed />
      </div>
    </div>
  );
}

function getMondayKey(d: Date): Date {
  const monday = new Date(d);
  const day = monday.getDay();
  monday.setDate(monday.getDate() + (day === 0 ? -6 : 1 - day));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

/** One quiet line answering "is it working?": fitness trend + week volume. */
function ProgressLine() {
  const { data: fitnessData } = useFitnessProfile();
  const { data: trendsData } = useMetricsTrends();
  const { data: planData } = useActivePlan();
  const { data: activityData } = useRecentActivities();

  const profile = fitnessData?.profile ?? null;
  const plan = planData?.plan ?? null;

  const weekKm = useMemo(() => {
    const monday = getMondayKey(new Date());
    const nextMonday = new Date(monday);
    nextMonday.setDate(monday.getDate() + 7);
    let km = 0;
    for (const a of activityData?.activities ?? []) {
      if (a.type !== "run" || !a.distanceMeters) continue;
      const start = new Date(a.startTime);
      if (start >= monday && start < nextMonday) {
        km += a.distanceMeters / 1000;
      }
    }
    return km;
  }, [activityData?.activities]);

  if (!profile && !plan) return null;

  const vo2Trend = trendsData?.trends?.find((t) => t.metric === "vo2Max");
  const targetKm = plan ? Number(plan.weeklyMileageTargetKm) : null;

  return (
    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-y border-rule px-1 py-2.5 text-sm">
      {profile && (
        <Link
          href="/dashboard/metrics"
          className="group flex items-baseline gap-2"
        >
          <span className="text-ink-faint">Fitness</span>
          <span className="font-mono font-semibold text-ink group-hover:text-pencil-red-deep">
            {profile.estimatedVDOT}
            {vo2Trend && (
              <span
                className={
                  vo2Trend.flag === "positive"
                    ? "ml-1 text-sage"
                    : vo2Trend.flag === "negative"
                      ? "ml-1 text-amber-pencil"
                      : "ml-1 text-ink-faint"
                }
              >
                {vo2Trend.direction === "up"
                  ? "↑"
                  : vo2Trend.direction === "down"
                    ? "↓"
                    : "—"}
              </span>
            )}
          </span>
          <span className="text-xs text-ink-faint">at least</span>
        </Link>
      )}
      <Link href="/dashboard/plan" className="group flex items-baseline gap-2">
        <span className="text-ink-faint">This week</span>
        <span className="font-mono font-semibold text-ink group-hover:text-pencil-red-deep">
          {weekKm.toFixed(1)}
          {targetKm ? ` / ${targetKm.toFixed(0)}` : ""} km
        </span>
      </Link>
    </div>
  );
}

/**
 * Health figures as small margin entries. Swaps to an awaiting-first-sync
 * note when Garmin is connected but no health data has landed yet.
 */
function MarginFigures() {
  const { data: today } = useDashboardToday();

  if (today && today.garminConnected && !today.hasAnyHealthData) {
    return (
      <div className="rounded-md border border-rule bg-paper-raised px-5 py-4">
        <p className="text-sm font-medium text-ink">
          Garmin is syncing your history
        </p>
        <p className="mt-0.5 text-xs text-ink-faint">
          Health figures appear within a day or two of connecting
        </p>
      </div>
    );
  }

  return <FiguresRow />;
}

function FiguresRow() {
  const { data, isLoading, error } = useMetricsSummary();

  if (isLoading) {
    return <div className="skeleton h-14 rounded-md" />;
  }

  if (error || !data) {
    return (
      <p className="px-1 text-xs text-pencil-red-deep">
        Couldn&apos;t load health figures.
      </p>
    );
  }

  return (
    <div className="grid overflow-hidden rounded-md border border-rule bg-paper-raised sm:grid-cols-2 sm:gap-x-8 sm:px-2">
      <Figure
        label="HRV last night"
        value={data.snapshot.hrvLastNight}
        unit="ms"
        baseline={data.baseline.hrvAvg}
        higherIsBetter
      />
      <Figure
        label="Sleep score"
        value={data.snapshot.sleepScore}
        unit=""
        baseline={data.baseline.sleepScoreAvg}
        higherIsBetter
      />
      <Figure
        label="Stress"
        value={data.snapshot.avgStress}
        unit=""
        baseline={data.baseline.stressAvg}
        higherIsBetter={false}
      />
      <Figure
        label="Body battery"
        value={data.snapshot.bodyBatteryStart}
        unit=""
        baseline={data.baseline.bodyBatteryStartAvg}
        higherIsBetter
      />
    </div>
  );
}

function Figure({
  label,
  value,
  unit,
  baseline,
  higherIsBetter,
}: {
  label: string;
  value: number | null;
  unit: string;
  baseline: number | null;
  higherIsBetter: boolean;
}) {
  const trend = getTrend(value, baseline, higherIsBetter);

  return (
    <Link
      href="/dashboard/metrics"
      className="flex items-baseline justify-between gap-3 border-b border-rule px-4 py-2.5 transition-colors last:border-b-0 hover:bg-paper-shade sm:px-2"
      title={
        baseline !== null && value !== null
          ? `${label}: ${value}${unit} — ${trend.label || "at your 28-day baseline"}. Tap for trends.`
          : `${label}. Tap for trends.`
      }
    >
      <span className="text-sm text-ink-soft">{label}</span>
      <span className="flex items-baseline gap-1.5">
        <span className="font-mono text-sm font-semibold tabular-nums text-ink">
          {value !== null ? value : "—"}
          {value !== null && unit && (
            <span className="ml-0.5 text-[11px] font-normal text-ink-faint">
              {unit}
            </span>
          )}
        </span>
        {baseline !== null && value !== null && (
          <span
            className={`text-[11px] font-medium ${trend.tone}`}
            aria-label={trend.label || "At baseline"}
          >
            {trend.arrow}
          </span>
        )}
      </span>
    </Link>
  );
}

function getTrend(
  value: number | null,
  baseline: number | null,
  higherIsBetter: boolean,
) {
  if (value === null || baseline === null) {
    return { arrow: "—", label: "", tone: "text-ink-faint" };
  }
  const diff = ((value - baseline) / baseline) * 100;
  const absDiff = Math.abs(diff);
  const improving = higherIsBetter ? diff > 3 : diff < -3;
  const declining = higherIsBetter ? diff < -3 : diff > 3;

  if (improving) {
    return {
      arrow: "↑",
      label: `${absDiff.toFixed(0)}% vs avg`,
      tone: "text-sage",
    };
  }
  if (declining) {
    return {
      arrow: "↓",
      label: `${absDiff.toFixed(0)}% vs avg`,
      tone: "text-amber-pencil",
    };
  }
  return { arrow: "—", label: "At baseline", tone: "text-ink-faint" };
}
