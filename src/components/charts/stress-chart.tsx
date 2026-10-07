"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceDot,
} from "recharts";
import { ChartContainer } from "@/components/charts/chart-container";

interface StressDataPoint {
  date: string;
  stress: number | null;
}

interface StressChartProps {
  data: StressDataPoint[];
}

export function StressChart({ data }: StressChartProps) {
  const filtered = data.filter((d) => d.stress !== null);

  if (filtered.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-md border border-dashed border-rule bg-paper">
        <p className="px-6 text-center text-sm text-ink-faint">
          No stress data yet — syncs with your watch&apos;s all-day readings.
        </p>
      </div>
    );
  }

  const latest = filtered[filtered.length - 1];

  return (
    <ChartContainer height={256}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 480, height: 256 }}>
        <LineChart
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
            domain={[0, 100]}
            tick={{ fontSize: 11, fill: "#848B94", fontFamily: "var(--font-data), monospace" }}
            stroke="#CCD6E2"
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.[0]) return null;
              const dateLabel = typeof label === "string" ? label : "";
              const val = payload[0].value as number;
              const level =
                val < 26
                  ? "Rest"
                  : val < 51
                    ? "Low"
                    : val < 76
                      ? "Medium"
                      : "High";
              return (
                <div className="rounded-md border border-rule bg-paper-raised px-3 py-2 shadow-[0_1px_4px_rgba(38,36,31,0.06)]">
                  <p className="text-xs text-ink-faint">{formatDate(dateLabel)}</p>
                  <p className="font-mono text-sm font-semibold text-ink tabular-nums">
                    {val}{" "}
                    <span className="font-sans text-xs font-normal text-ink-soft">
                      {level}
                    </span>
                  </p>
                </div>
              );
            }}
          />
          <Line
            type="monotone"
            dataKey="stress"
            stroke="#22252A"
            strokeWidth={1.5}
            dot={{ r: 2, fill: "#22252A", strokeWidth: 0 }}
            activeDot={{ r: 4, fill: "#22252A" }}
            connectNulls
          />
          {latest.stress !== null && (
            <ReferenceDot
              x={latest.date}
              y={latest.stress}
              r={3.5}
              fill="#BC3A2A"
              stroke="#FDFDFC"
              strokeWidth={1}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
