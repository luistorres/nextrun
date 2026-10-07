"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import {
  useMetricsTrends,
  useMetricsSummary,
  useRecentActivities,
  useFitnessProfile,
  useGoals,
} from "@/lib/query/hooks";
import { DateRangeSelector } from "@/components/charts/date-range-selector";
import { Card } from "@/components/ui/card";
import type { MetricsTrend } from "@/types/metrics";

const HrvChart = dynamic(
  () =>
    import("@/components/charts/hrv-chart").then((mod) => ({
      default: mod.HrvChart,
    })),
  { ssr: false, loading: () => <ChartSkeleton /> }
);

const SleepChart = dynamic(
  () =>
    import("@/components/charts/sleep-chart").then((mod) => ({
      default: mod.SleepChart,
    })),
  { ssr: false, loading: () => <ChartSkeleton /> }
);

const StressChart = dynamic(
  () =>
    import("@/components/charts/stress-chart").then((mod) => ({
      default: mod.StressChart,
    })),
  { ssr: false, loading: () => <ChartSkeleton /> }
);

const TrainingLoadChart = dynamic(
  () =>
    import("@/components/charts/training-load-chart").then((mod) => ({
      default: mod.TrainingLoadChart,
    })),
  { ssr: false, loading: () => <ChartSkeleton /> }
);

const VO2MaxChart = dynamic(
  () =>
    import("@/components/charts/vo2max-chart").then((mod) => ({
      default: mod.VO2MaxChart,
    })),
  { ssr: false, loading: () => <ChartSkeleton /> }
);

const FitnessStatsCard = dynamic(
  () =>
    import("@/components/metrics/fitness-stats-card").then((mod) => ({
      default: mod.FitnessStatsCard,
    })),
  { ssr: false }
);

const VERDICTS: Record<string, Record<MetricsTrend["flag"], string>> = {
  hrv: {
    positive: "Above your 28-day baseline — recovery is trending well.",
    neutral: "Inside your normal band.",
    negative: "Below your 28-day baseline — watch recovery.",
  },
  sleep: {
    positive: "Sleeping better than your recent average.",
    neutral: "Steady against your baseline.",
    negative: "Below your recent average — protect your evenings.",
  },
  stress: {
    positive: "Lower than your baseline.",
    neutral: "Holding at your usual level.",
    negative: "Above your baseline — keep the easy days easy.",
  },
  vo2Max: {
    positive: "Trending up against your baseline.",
    neutral: "Holding steady.",
    negative: "Slightly down — normal within a hard training block.",
  },
};

function verdictFor(
  trends: MetricsTrend[] | undefined,
  metric: string
): string | null {
  const trend = trends?.find((t) => t.metric === metric);
  if (!trend) return null;
  return VERDICTS[metric]?.[trend.flag] ?? null;
}

export default function MetricsPage() {
  const [days, setDays] = useState(30);
  const {
    data: trendsData,
    isLoading: trendsLoading,
    error: trendsError,
  } = useMetricsTrends(days || undefined);
  const { data: summaryData } = useMetricsSummary();
  const { data: activitiesData } = useRecentActivities();
  const { data: fitnessData, isLoading: fitnessLoading } = useFitnessProfile();
  const { data: goalsData } = useGoals();

  const plannedDaysPerWeek =
    goalsData?.goals.find((g) => g.status === "active")
      ?.trainingDaysPerWeek ?? null;

  const rangeLabel = days === 0 ? "all recorded" : `${days}-day`;
  const trends = trendsData?.trends;

  return (
    <div className="space-y-6 pb-20 lg:pb-0">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink">Metrics</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Health and training trends over the {rangeLabel} window
          </p>
        </div>
        <DateRangeSelector value={days} onChange={setDays} />
      </div>

      {trends && trends.length > 0 && (
        <div className="grid overflow-hidden rounded-md border border-rule bg-paper-raised lg:grid-cols-2 lg:gap-x-8 lg:px-2">
          {trends.map((trend) => (
            <TrendFigure key={trend.metric} trend={trend} />
          ))}
        </div>
      )}

      {trendsError && (
        <div className="rounded-md border border-rule bg-red-soft p-4">
          <p className="text-sm text-pencil-red-deep">
            Couldn&apos;t load metrics. Try again in a moment.
          </p>
        </div>
      )}

      <ChartCard title="Training load">
        <TrainingLoadChart activities={activitiesData?.activities ?? []} />
      </ChartCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          title="Heart rate variability"
          verdict={verdictFor(trends, "hrv")}
        >
          {trendsLoading ? (
            <ChartSkeleton />
          ) : (
            <HrvChart
              data={
                trendsData?.dailyPoints.map((d) => ({
                  date: d.date,
                  hrv: d.hrv,
                })) ?? []
              }
              baselineAvg={summaryData?.baseline.hrvAvg ?? null}
            />
          )}
        </ChartCard>

        <ChartCard title="Sleep" verdict={verdictFor(trends, "sleep")}>
          {trendsLoading ? (
            <ChartSkeleton />
          ) : (
            <SleepChart
              data={
                trendsData?.dailyPoints.map((d) => ({
                  date: d.date,
                  sleepScore: d.sleepScore,
                  sleepHours: d.sleepHours,
                })) ?? []
              }
            />
          )}
        </ChartCard>

        <ChartCard title="Stress" verdict={verdictFor(trends, "stress")}>
          {trendsLoading ? (
            <ChartSkeleton />
          ) : (
            <StressChart
              data={
                trendsData?.dailyPoints.map((d) => ({
                  date: d.date,
                  stress: d.stress,
                })) ?? []
              }
            />
          )}
        </ChartCard>

        <ChartCard title="VO2 max" verdict={verdictFor(trends, "vo2Max")}>
          {trendsLoading ? (
            <ChartSkeleton />
          ) : (
            <VO2MaxChart
              data={
                trendsData?.dailyPoints.map((d) => ({
                  date: d.date,
                  vo2Max: d.vo2Max,
                })) ?? []
              }
              baselineAvg={summaryData?.baseline.vo2MaxAvg ?? null}
            />
          )}
        </ChartCard>
      </div>

      <div>
        <h2 className="mb-1 text-lg font-semibold text-ink">
          Fitness profile
        </h2>
        <p className="mb-4 text-xs text-ink-faint">
          Computed from your recent training data
        </p>
        <FitnessStatsCard
          profile={fitnessData?.profile ?? null}
          isLoading={fitnessLoading}
          plannedDaysPerWeek={plannedDaysPerWeek}
        />
      </div>
    </div>
  );
}

function TrendFigure({
  trend,
  className = "",
}: {
  trend: MetricsTrend;
  className?: string;
}) {
  const labels: Record<string, string> = {
    hrv: "HRV",
    sleep: "Sleep score",
    stress: "Stress",
    restingHR: "Resting HR",
    vo2Max: "VO2 max",
  };

  const units: Record<string, string> = {
    hrv: "ms",
    restingHR: "bpm",
  };

  const tones: Record<MetricsTrend["flag"], string> = {
    positive: "text-sage",
    negative: "text-amber-pencil",
    neutral: "text-ink-faint",
  };

  const arrows: Record<string, string> = {
    up: "↑",
    down: "↓",
    stable: "—",
  };

  return (
    <div
      className={`flex items-baseline justify-between gap-3 border-b border-rule px-4 py-2.5 last:border-b-0 lg:px-2 ${className}`}
    >
      <span className="text-sm text-ink-soft">
        {labels[trend.metric] ?? trend.metric}
        <span className="ml-1.5 text-[11px] text-ink-faint">7d avg</span>
      </span>
      <span className="flex items-baseline gap-1.5">
        <span className="font-mono text-sm font-semibold tabular-nums text-ink">
          {trend.current7dAvg.toFixed(1)}
          {units[trend.metric] && (
            <span className="ml-0.5 text-[10px] font-normal text-ink-faint">
              {units[trend.metric]}
            </span>
          )}
        </span>
        <span
          className={`text-[11px] font-medium ${tones[trend.flag]}`}
          title={`${Math.abs(trend.changePercent).toFixed(1)}% vs 28-day baseline`}
        >
          {arrows[trend.direction]} {Math.abs(trend.changePercent).toFixed(1)}%
        </span>
      </span>
    </div>
  );
}

function ChartCard({
  title,
  verdict,
  children,
}: {
  title: string;
  verdict?: string | null;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-6">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-ink">{title}</h3>
        {verdict && <p className="mt-0.5 text-sm text-ink-soft">{verdict}</p>}
      </div>
      {children}
    </Card>
  );
}

function ChartSkeleton() {
  return <div className="skeleton h-64 w-full" />;
}
