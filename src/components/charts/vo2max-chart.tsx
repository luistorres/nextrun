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

interface VO2MaxDataPoint {
  date: string;
  vo2Max: number | null;
}

interface VO2MaxChartProps {
  data: VO2MaxDataPoint[];
  baselineAvg: number | null;
}

function getFitnessLevel(vo2Max: number): string {
  if (vo2Max >= 65) return "Elite";
  if (vo2Max >= 50) return "Advanced";
  if (vo2Max >= 35) return "Intermediate";
  return "Beginner";
}

export function VO2MaxChart({ data, baselineAvg }: VO2MaxChartProps) {
  const filtered = data.filter((d) => d.vo2Max !== null);

  if (filtered.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-md border border-dashed border-rule bg-paper">
        <p className="px-6 text-center text-sm text-ink-faint">
          No VO2 max data yet — Garmin estimates it after a few outdoor runs.
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
          />
          {baselineAvg !== null && (
            <ReferenceArea
              y1={baselineAvg * 0.97}
              y2={baselineAvg * 1.03}
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
              const val = payload[0].value as number;
              return (
                <div className="rounded-md border border-rule bg-paper-raised px-3 py-2 shadow-[0_1px_4px_rgba(38,36,31,0.06)]">
                  <p className="text-xs text-ink-faint">{formatDate(dateLabel)}</p>
                  <p className="font-mono text-sm font-semibold text-ink tabular-nums">
                    {val}{" "}
                    <span className="font-sans text-xs font-normal text-ink-soft">
                      {getFitnessLevel(val)}
                    </span>
                  </p>
                  {baselineAvg !== null && (
                    <p className="font-mono text-xs text-ink-soft tabular-nums">
                      Baseline: {baselineAvg.toFixed(1)}
                    </p>
                  )}
                </div>
              );
            }}
          />
          <Line
            type="monotone"
            dataKey="vo2Max"
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
                value: `Baseline ${baselineAvg.toFixed(1)}`,
                position: "insideTopRight",
                fill: "#848B94",
                fontSize: 11,
                fontFamily: "var(--font-data), monospace",
                dy: -8,
              }}
            />
          )}
          {latest.vo2Max !== null && (
            <ReferenceDot
              x={latest.date}
              y={latest.vo2Max}
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
