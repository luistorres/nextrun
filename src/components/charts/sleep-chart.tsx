"use client";

import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { ChartContainer } from "@/components/charts/chart-container";

interface SleepDataPoint {
  date: string;
  sleepScore: number | null;
  sleepHours: number | null;
}

interface SleepChartProps {
  data: SleepDataPoint[];
}

export function SleepChart({ data }: SleepChartProps) {
  const filtered = data.filter(
    (d) => d.sleepScore !== null || d.sleepHours !== null
  );

  if (filtered.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-md border border-dashed border-rule bg-paper">
        <p className="px-6 text-center text-sm text-ink-faint">
          No sleep data yet — appears after your first synced night.
        </p>
      </div>
    );
  }

  return (
    <ChartContainer height={256}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 480, height: 256 }}>
        <ComposedChart
          data={filtered}
          margin={{ top: 8, right: 12, bottom: 0, left: -12 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#CCD6E2" strokeWidth={0.5} />
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            tick={{ fontSize: 11, fill: "#848B94", fontFamily: "var(--font-data), monospace" }}
            stroke="#CCD6E2"
          />
          <YAxis
            yAxisId="score"
            domain={[0, 100]}
            tick={{ fontSize: 11, fill: "#848B94", fontFamily: "var(--font-data), monospace" }}
            stroke="#CCD6E2"
          />
          <YAxis
            yAxisId="hours"
            orientation="right"
            domain={[0, 12]}
            tick={{ fontSize: 11, fill: "#848B94", fontFamily: "var(--font-data), monospace" }}
            stroke="#CCD6E2"
            unit="h"
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const dateLabel = typeof label === "string" ? label : "";
              const score = payload.find((p) => p.dataKey === "sleepScore");
              const hours = payload.find((p) => p.dataKey === "sleepHours");
              return (
                <div className="rounded-md border border-rule bg-paper-raised px-3 py-2 shadow-[0_1px_4px_rgba(38,36,31,0.06)]">
                  <p className="text-xs text-ink-faint">{formatDate(dateLabel)}</p>
                  {score?.value != null && (
                    <p className="font-mono text-sm font-semibold text-ink tabular-nums">
                      Score: {score.value}
                    </p>
                  )}
                  {hours?.value != null && (
                    <p className="font-mono text-xs text-ink-soft tabular-nums">
                      {hours.value}h sleep
                    </p>
                  )}
                </div>
              );
            }}
          />
          <Bar
            yAxisId="hours"
            dataKey="sleepHours"
            fill="#CCD6E2"
            opacity={0.55}
            radius={[2, 2, 0, 0]}
          />
          <Line
            yAxisId="score"
            type="monotone"
            dataKey="sleepScore"
            stroke="#22252A"
            strokeWidth={1.5}
            dot={{ r: 2, fill: "#22252A", strokeWidth: 0 }}
            activeDot={{ r: 4, fill: "#22252A" }}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
