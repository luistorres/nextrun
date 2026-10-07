"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
  ReferenceDot,
} from "recharts";
import { ChartContainer } from "@/components/charts/chart-container";

interface HrvDataPoint {
  date: string;
  hrv: number | null;
}

interface HrvChartProps {
  data: HrvDataPoint[];
  baselineAvg: number | null;
}

export function HrvChart({ data, baselineAvg }: HrvChartProps) {
  const filtered = data.filter((d) => d.hrv !== null);

  if (filtered.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-md border border-dashed border-rule bg-paper">
        <p className="px-6 text-center text-sm text-ink-faint">
          No HRV data yet — appears after your first synced night.
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
            domain={["auto", "auto"]}
            tick={{ fontSize: 11, fill: "#848B94", fontFamily: "var(--font-data), monospace" }}
            stroke="#CCD6E2"
            unit=" ms"
          />
          {/* ±10% around the 28-day mean — a practical stand-in for a personal normal band */}
          {baselineAvg !== null && (
            <ReferenceArea
              y1={baselineAvg * 0.9}
              y2={baselineAvg * 1.1}
              fill="#E9F1EC"
              fillOpacity={1}
              stroke="none"
              ifOverflow="extendDomain"
            />
          )}
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.[0]) return null;
              const dateLabel = typeof label === "string" ? label : "";
              return (
                <div className="rounded-md border border-rule bg-paper-raised px-3 py-2 shadow-[0_1px_4px_rgba(38,36,31,0.06)]">
                  <p className="text-xs text-ink-faint">{formatDate(dateLabel)}</p>
                  <p className="font-mono text-sm font-semibold text-ink tabular-nums">
                    {payload[0].value} ms
                  </p>
                  {baselineAvg !== null && (
                    <p className="font-mono text-xs text-ink-soft tabular-nums">
                      Baseline: {baselineAvg.toFixed(0)} ms
                    </p>
                  )}
                </div>
              );
            }}
          />
          <Line
            type="monotone"
            dataKey="hrv"
            stroke="#22252A"
            strokeWidth={1.5}
            dot={{ r: 2, fill: "#22252A", strokeWidth: 0 }}
            activeDot={{ r: 4, fill: "#22252A" }}
            connectNulls
          />
          {baselineAvg !== null && (
            <ReferenceLine
              y={baselineAvg}
              stroke="#A8B8C9"
              strokeDasharray="6 4"
              label={{
                value: `Baseline ${baselineAvg.toFixed(0)}`,
                position: "insideTopRight",
                fill: "#848B94",
                fontSize: 11,
                fontFamily: "var(--font-data), monospace",
                dy: -8,
              }}
            />
          )}
          {latest.hrv !== null && (
            <ReferenceDot
              x={latest.date}
              y={latest.hrv}
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
