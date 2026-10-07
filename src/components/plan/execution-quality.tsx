"use client";

import { decimalMinPerKmToDisplay } from "@/lib/utils/pace";

export type ExecutionQuality = "exceeds" | "on_target" | "partial" | "minimal";

export interface ExecutionResult {
  ratio: number;
  label: ExecutionQuality;
  color: string;
  /** Short display string e.g. "102%" or "25%" */
  pct: string;
  icon: "✓" | "⚠";
}

const QUALITY_COLORS: Record<ExecutionQuality, string> = {
  exceeds: "var(--sage)",
  on_target: "var(--sage)",
  partial: "var(--amber-pencil)",
  minimal: "var(--amber-pencil)",
};

const QUALITY_LABELS: Record<ExecutionQuality, string> = {
  exceeds: "Beyond target",
  on_target: "On target",
  partial: "Partial",
  minimal: "Minimal",
};

/**
 * Quality thresholds mirror backend workout-execution.ts:
 * >1.10 exceeds, 0.80–1.10 on_target, 0.40–0.79 partial, <0.40 minimal.
 */
export function computeExecution(
  targetMeters: number | null | undefined,
  actualMeters: number | null | undefined,
): ExecutionResult | null {
  if (!targetMeters || targetMeters <= 0) return null;
  const actual = actualMeters ?? 0;
  const ratio = actual / targetMeters;

  let label: ExecutionQuality;
  if (ratio > 1.1) label = "exceeds";
  else if (ratio >= 0.8) label = "on_target";
  else if (ratio >= 0.4) label = "partial";
  else label = "minimal";

  return {
    ratio,
    label,
    color: QUALITY_COLORS[label],
    pct: `${Math.round(ratio * 100)}%`,
    icon: label === "exceeds" || label === "on_target" ? "✓" : "⚠",
  };
}

export function ExecutionBar({
  targetMeters,
  actualMeters,
}: {
  targetMeters: number | null | undefined;
  actualMeters: number | null | undefined;
}) {
  const exec = computeExecution(targetMeters, actualMeters);
  if (!exec) return null;

  return (
    <div
      className="mt-0.5 h-[3px] w-full overflow-hidden rounded-full bg-paper-shade"
      role="progressbar"
      aria-valuenow={Math.round(exec.ratio * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Workout execution"
    >
      <div
        className="h-full rounded-full transition-all duration-200"
        style={{
          width: `${Math.min(exec.ratio * 100, 100)}%`,
          background: exec.color,
        }}
      />
    </div>
  );
}

export function ExecutionBadge({
  targetMeters,
  actualMeters,
  showLabel = false,
}: {
  targetMeters: number | null | undefined;
  actualMeters: number | null | undefined;
  showLabel?: boolean;
}) {
  const exec = computeExecution(targetMeters, actualMeters);
  if (!exec) return null;

  const onTarget = exec.label === "exceeds" || exec.label === "on_target";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] font-medium tabular-nums ${
        onTarget ? "bg-sage-soft text-sage" : "bg-amber-soft text-amber-pencil"
      }`}
      aria-label={`Execution: ${QUALITY_LABELS[exec.label]} at ${exec.pct}`}
    >
      <span>{exec.icon}</span>
      {showLabel && <span>{QUALITY_LABELS[exec.label]}</span>}
      <span>{exec.pct}</span>
    </span>
  );
}

export type WorkoutDotData = {
  targetMeters: number | null;
  actualMeters: number | null;
  isPast: boolean;
  isMissed: boolean;
};

export function WeekComplianceDots({ dots }: { dots: WorkoutDotData[] }) {
  if (dots.length === 0) return null;

  return (
    <div className="mt-1 flex items-center gap-0.5">
      {dots.map((dot, i) => {
        let color: string;
        if (!dot.isPast) {
          color = "var(--rule)";
        } else if (dot.isMissed) {
          color = "var(--amber-pencil)";
        } else {
          const exec = computeExecution(dot.targetMeters, dot.actualMeters);
          color = exec ? exec.color : "var(--rule-strong)";
        }
        return (
          <div
            key={i}
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: color }}
          />
        );
      })}
    </div>
  );
}

function formatDistance(meters: number | null | undefined): string {
  if (!meters || meters <= 0) return "—";
  return meters >= 1000
    ? `${(meters / 1000).toFixed(2)} km`
    : `${Math.round(meters)} m`;
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatPace(secsPerKm: number | string | null | undefined): string {
  if (!secsPerKm) return "—";
  const secs = typeof secsPerKm === "string" ? parseFloat(secsPerKm) : secsPerKm;
  if (!secs || secs <= 0) return "—";
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

const COACHING_NOTES: Record<ExecutionQuality, (pct: string) => string> = {
  exceeds: () => "You went beyond the target. Strong work.",
  on_target: () => "Run as written. That consistency is the training.",
  partial: (pct) => `You covered ${pct} of the target distance.`,
  minimal: (pct) =>
    `Only ${pct} of the target was covered. If fatigue or illness cut this short, mark it skipped so the plan can adjust.`,
};

interface CompletedActivity {
  distanceMeters: number | null;
  durationSeconds: number | null;
  avgPaceSecondsPerKm: number | null;
  avgHeartRate: number | null;
}

interface PlannedTargets {
  targetDistanceMeters: number | null;
  targetDurationSeconds: number | null;
  targetPaceMinPerKm: string | null;
}

export function ExecutionPanel({
  planned,
  actual,
  linkedActivityCount,
}: {
  planned: PlannedTargets;
  actual: CompletedActivity;
  linkedActivityCount?: number;
}) {
  const exec = computeExecution(
    planned.targetDistanceMeters,
    actual.distanceMeters,
  );
  if (!exec) return null;

  const note = COACHING_NOTES[exec.label](exec.pct);
  const onTarget = exec.label === "exceeds" || exec.label === "on_target";

  const rows: { label: string; planned: string; actual: string }[] = [
    {
      label: "Distance",
      planned: formatDistance(planned.targetDistanceMeters),
      actual: formatDistance(actual.distanceMeters),
    },
    {
      label: "Duration",
      planned: formatDuration(planned.targetDurationSeconds),
      actual: formatDuration(actual.durationSeconds),
    },
  ];
  if (planned.targetPaceMinPerKm || actual.avgPaceSecondsPerKm) {
    rows.push({
      label: "Pace",
      planned: planned.targetPaceMinPerKm
        ? `${decimalMinPerKmToDisplay(planned.targetPaceMinPerKm)}/km`
        : "—",
      actual: formatPace(actual.avgPaceSecondsPerKm),
    });
  }
  if (actual.avgHeartRate) {
    rows.push({
      label: "Avg HR",
      planned: "—",
      actual: `${actual.avgHeartRate} bpm`,
    });
  }

  return (
    <section className="rounded-md border border-rule bg-paper-raised shadow-[0_1px_4px_rgba(38,36,31,0.06)]">
      <div className="flex items-center justify-between border-b border-rule px-5 py-3">
        <h3 className="text-sm font-semibold text-ink">Execution</h3>
        <span
          className={`stamp text-[11px] ${
            onTarget ? "text-sage" : "text-amber-pencil"
          }`}
        >
          {QUALITY_LABELS[exec.label]} · {exec.pct}
        </span>
      </div>

      <div className="px-5 py-4">
        {linkedActivityCount != null && linkedActivityCount > 1 && (
          <p className="mb-3 text-xs text-ink-faint">
            Combined from {linkedActivityCount} activities
          </p>
        )}

        <table className="w-full font-mono text-sm tabular-nums">
          <thead>
            <tr className="text-left text-xs font-medium uppercase tracking-wide text-ink-faint">
              <th className="pb-2 font-medium" />
              <th className="pb-2 font-medium">Planned</th>
              <th className="pb-2 font-medium">Actual</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-t border-rule">
                <td className="py-2 pr-4 font-sans text-xs text-ink-soft">
                  {row.label}
                </td>
                <td className="py-2 pr-4 text-ink-soft">{row.planned}</td>
                <td className="py-2 text-ink">{row.actual}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="coach-note mt-4 text-sm leading-snug">{note}</p>
      </div>
    </section>
  );
}
