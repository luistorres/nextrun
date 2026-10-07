"use client";

import Link from "next/link";

interface WorkoutCardProps {
  id: string;
  workoutType: string;
  title: string;
  targetDistanceMeters: number | null;
  targetDurationSeconds: number | null;
  completionStatus: string;
  compact?: boolean;
  variant?: CardVariant;
  hasFeedback?: boolean;
}

export type CardVariant = "default" | "completed";

export function getTypeColors(
  ...args: [type?: string, variant?: CardVariant]
): {
  bg: string;
  border: string;
  badge: string;
  badgeText: string;
} {
  void args;
  return {
    bg: "bg-paper-raised",
    border: "border-rule",
    badge: "bg-paper-shade",
    badgeText: "text-ink-soft",
  };
}

export function getTypeAbbreviation(type: string): string {
  switch (type) {
    case "easy_run":
      return "Easy";
    case "recovery":
      return "Rec";
    case "long_run":
      return "Long";
    case "tempo":
      return "Tempo";
    case "race_pace":
      return "Race";
    case "intervals":
      return "Int";
    case "hill_repeats":
      return "Hills";
    case "fartlek":
      return "Fartlek";
    case "rest":
      return "Rest";
    case "cross_training":
      return "Cross";
    case "race":
      return "Race";
    default:
      return type.slice(0, 4);
  }
}

function StatusMark({ status }: { status: string }) {
  switch (status) {
    case "completed":
      return (
        <svg
          className="pencil-check h-3.5 w-3.5 shrink-0 text-sage"
          viewBox="0 0 24 24"
          fill="none"
          aria-label="Completed"
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
    case "skipped":
      return <span className="text-[11px] text-amber-pencil">skipped</span>;
    case "partial":
      return <span className="text-[11px] text-amber-pencil">partial</span>;
    default:
      return null;
  }
}

function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${meters} m`;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h${m > 0 ? ` ${m}m` : ""}`;
  return `${m}m`;
}

export function WorkoutCard({
  id,
  workoutType,
  title,
  targetDistanceMeters,
  targetDurationSeconds,
  completionStatus,
  compact = false,
  hasFeedback,
}: WorkoutCardProps) {
  const abbrev = getTypeAbbreviation(workoutType);
  const metric = targetDistanceMeters
    ? formatDistance(targetDistanceMeters)
    : targetDurationSeconds
      ? formatDuration(targetDurationSeconds)
      : null;

  if (compact) {
    return (
      <Link
        href={`/dashboard/plan/workout/${id}`}
        className="block rounded border border-rule bg-paper-raised p-1.5 transition-colors duration-150 hover:bg-paper-shade"
      >
        <div className="flex items-center justify-between gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
            {abbrev}
          </span>
          <StatusMark status={completionStatus} />
        </div>
        <p className="mt-0.5 truncate text-[11px] font-medium text-ink">
          {title}
        </p>
        {metric && (
          <p className="mt-0.5 font-mono text-[10px] tabular-nums text-ink-soft">
            {metric}
          </p>
        )}
      </Link>
    );
  }

  return (
    <Link
      href={`/dashboard/plan/workout/${id}`}
      className="block rounded-md border border-rule bg-paper-raised p-3 transition-colors duration-150 hover:bg-paper-shade"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
          {abbrev}
        </span>
        <StatusMark status={completionStatus} />
      </div>
      <p className="mt-1 truncate text-sm font-medium text-ink">{title}</p>
      <div className="mt-1 flex gap-3 font-mono text-xs tabular-nums text-ink-soft">
        {targetDistanceMeters && <span>{formatDistance(targetDistanceMeters)}</span>}
        {targetDurationSeconds && <span>{formatDuration(targetDurationSeconds)}</span>}
      </div>
      {(completionStatus === "completed" || completionStatus === "skipped") &&
        hasFeedback === false && (
          <p className="mt-1.5 text-[11px] font-medium text-pencil-red">
            Add a note
          </p>
        )}
    </Link>
  );
}
