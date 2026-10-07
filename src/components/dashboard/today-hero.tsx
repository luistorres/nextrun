"use client";

import Link from "next/link";
import { useDashboardToday } from "@/lib/query/hooks";
import { ExecutionBadge } from "@/components/plan/execution-quality";
import type {
  TodayReadiness,
  TodayResponse,
  TodayWorkout,
  TomorrowPreview,
  CompletedRunSummary,
  TodayGoalContext,
} from "@/types/dashboard";
import type { RecoveryStatus } from "@/lib/metrics/derived";

function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${meters} m`;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h${m > 0 ? ` ${m}m` : ""}`;
  return `${m} min`;
}

function formatPace(secsPerKm: number): string {
  const m = Math.floor(secsPerKm / 60);
  const s = Math.round(secsPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

const WORKOUT_TYPE_LABELS: Record<string, string> = {
  easy_run: "Easy",
  tempo_run: "Tempo",
  interval: "Intervals",
  long_run: "Long run",
  recovery_run: "Recovery",
  race: "Race",
  cross_training: "Cross",
  rest: "Rest",
};

function typeLabel(type: string): string {
  return WORKOUT_TYPE_LABELS[type] ?? type.replace(/_/g, " ");
}

// The coach's margin verdict: one plain sentence built from readiness state.
const READINESS_NOTE: Record<RecoveryStatus, string> = {
  ready: "Recovered. Run this as written.",
  moderate: "Recovery is middling. Run it, keep the effort honest.",
  fatigued: "Carrying fatigue. Ease off if it feels hard.",
  depleted: "Recovery is poor. Consider swapping today for rest.",
  unknown: "No recovery data yet. Go by feel.",
};

function coachNoteFor(data: TodayResponse): string {
  if (data.state === "rest_day" && data.readiness.status !== "unknown") {
    return "Rest day. Recovery is where the adaptation happens.";
  }
  return READINESS_NOTE[data.readiness.status];
}

function PencilUnderline() {
  return (
    <svg
      className="pencil-stroke -mt-0.5 block h-2 w-36"
      viewBox="0 0 144 8"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M2 5.5C30 3 68 2.5 96 4c18 1 32 1.5 46 .5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        pathLength="1"
      />
    </svg>
  );
}

/**
 * Coach margin note — the world's signature: readiness verdict rendered as a
 * penciled annotation with a hand-drawn underline.
 */
function CoachMarginNote({
  note,
  drivers,
  missing,
  confidence,
}: {
  note: string;
  drivers: string[];
  missing: string[];
  confidence: TodayReadiness["confidence"];
}) {
  return (
    <div className="coach-note min-w-0 pl-8 sm:pl-0">
      <p className="text-base font-medium leading-snug">{note}</p>
      <PencilUnderline />
      {(drivers.length > 0 || (confidence === "partial" && missing.length > 0)) && (
        <p className="mt-1.5 text-sm leading-snug opacity-80">
          {drivers.join(" · ")}
          {confidence === "partial" && missing.length > 0 && (
            <span> · no {missing.join(", ")} data</span>
          )}
        </p>
      )}
    </div>
  );
}

export function TodayHero() {
  const { data, isLoading, error, refetch } = useDashboardToday();

  if (isLoading) return <HeroSkeleton />;

  if (error || !data) {
    return (
      <section className="rounded-md border border-rule bg-paper-raised p-6">
        <p className="text-sm text-pencil-red-deep">
          Couldn&apos;t load today&apos;s page.
        </p>
        <button
          type="button"
          onClick={() => refetch()}
          className="mt-3 rounded border border-rule-strong px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:bg-paper-shade"
        >
          Try again
        </button>
      </section>
    );
  }

  const today = new Date();
  const dateLine = today.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <section className="overflow-hidden rounded-md border border-rule bg-paper-raised shadow-[0_1px_4px_rgba(38,36,31,0.06)]">
      {/* Sheet header: date line + plan stamp */}
      <div className="flex items-center justify-between gap-3 border-b border-rule px-5 py-3 sm:px-7">
        <h2 className="text-sm font-semibold text-ink">{dateLine}</h2>
        {data.goalContext && (
          <span className="stamp text-[11px] text-ink-soft">
            {stampLine(data.goalContext)}
          </span>
        )}
      </div>

      {/* Today's entry on ruled paper */}
      <div className="log-sheet pb-6 pl-10 pr-5 pt-4 sm:pl-12 sm:pr-7">
        {data.state === "pre_run" && (
          <PreRunEntry workout={data.workout} note={coachNoteFor(data)} readiness={data.readiness} />
        )}
        {data.state === "post_run" && (
          <PostRunEntry completed={data.completed} note={coachNoteFor(data)} readiness={data.readiness} />
        )}
        {data.state === "rest_day" && (
          <RestDayEntry tomorrow={data.tomorrow} note={coachNoteFor(data)} readiness={data.readiness} />
        )}
        {data.state === "no_plan" && <NoPlanEntry />}
      </div>

      {data.dataFreshness === "stale" && (
        <p className="border-t border-rule bg-amber-soft px-5 py-2 text-xs text-amber-pencil sm:px-7">
          Waiting for your watch to sync — this page shows yesterday&apos;s
          data.
        </p>
      )}
    </section>
  );
}

function stampLine(goal: TodayGoalContext): string {
  if (goal.daysToRace === 0) return "Race day";
  return `Week ${goal.currentWeek}/${goal.totalWeeks} · ${goal.daysToRace}d to ${goal.raceName ?? "race"}`;
}

function PreRunEntry({
  workout,
  note,
  readiness,
}: {
  workout: TodayWorkout;
  note: string;
  readiness: TodayReadiness;
}) {
  return (
    <div className="grid gap-x-6 gap-y-4 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] sm:items-start">
      <div className="min-w-0">
        <h3 className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xl font-bold leading-tight text-ink sm:text-3xl">
          {workout.title}
          <span className="stamp text-[11px] font-semibold text-ink-soft">
            {typeLabel(workout.workoutType)}
          </span>
        </h3>
        <p className="mt-2 font-mono text-sm text-ink-soft">
          {[
            workout.targetDistanceMeters
              ? formatDistance(workout.targetDistanceMeters)
              : workout.targetDurationSeconds
                ? formatDuration(workout.targetDurationSeconds)
                : null,
            workout.targetPaceSecondsPerKm
              ? formatPace(workout.targetPaceSecondsPerKm)
              : null,
          ]
            .filter(Boolean)
            .join("  ·  ")}
        </p>
        {workout.description && (
          <p className="mt-2 hidden max-w-prose text-sm leading-relaxed text-ink-soft sm:block">
            {workout.description}
          </p>
        )}
        <Link
          href={`/dashboard/plan/workout/${workout.id}`}
          className="mt-4 hidden rounded bg-pencil-red px-4 py-2 text-sm font-semibold text-paper-raised transition-colors hover:bg-pencil-red-deep sm:inline-block"
        >
          Open workout
        </Link>
      </div>

      <CoachMarginNote
        note={note}
        drivers={readiness.drivers}
        missing={readiness.missing}
        confidence={readiness.confidence}
      />

      <div className="sm:hidden">
        {workout.description && (
          <p className="max-w-prose text-sm leading-relaxed text-ink-soft">
            {workout.description}
          </p>
        )}
        <Link
          href={`/dashboard/plan/workout/${workout.id}`}
          className="mt-3 inline-block rounded bg-pencil-red px-4 py-2 text-sm font-semibold text-paper-raised transition-colors hover:bg-pencil-red-deep"
        >
          Open workout
        </Link>
      </div>
    </div>
  );
}

function PostRunEntry({
  completed,
  note,
  readiness,
}: {
  completed: CompletedRunSummary;
  note: string;
  readiness: TodayReadiness;
}) {
  const workout = completed.workout;
  const detailHref = workout ? `/dashboard/plan/workout/${workout.id}` : null;

  return (
    <div className="grid gap-6 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] sm:items-start">
      <div className="min-w-0">
        <h3 className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xl font-bold leading-tight text-ink sm:text-3xl">
          {workout?.title ?? "Unplanned run"}
          <DoneTick />
          {workout && (
            <span className="stamp text-[11px] font-semibold text-sage">
              {typeLabel(workout.workoutType)} — done
            </span>
          )}
        </h3>
        <p className="mt-2 font-mono text-sm text-ink-soft">
          {[
            completed.distanceMeters != null
              ? formatDistance(completed.distanceMeters)
              : null,
            completed.durationSeconds != null
              ? formatDuration(completed.durationSeconds)
              : null,
            completed.avgPaceSecondsPerKm != null
              ? formatPace(completed.avgPaceSecondsPerKm)
              : null,
          ]
            .filter(Boolean)
            .join("  ·  ")}
        </p>
        {workout && completed.distanceMeters != null && (
          <div className="mt-2">
            <ExecutionBadge
              targetMeters={workout.targetDistanceMeters}
              actualMeters={completed.distanceMeters}
            />
          </div>
        )}

        {detailHref && !completed.rpeGiven ? (
          <Link
            href={detailHref}
            className="mt-4 inline-block rounded bg-pencil-red px-4 py-2 text-sm font-semibold text-paper-raised transition-colors hover:bg-pencil-red-deep"
          >
            How hard did it feel?
          </Link>
        ) : detailHref && !completed.feedbackGiven ? (
          <Link
            href={detailHref}
            className="mt-4 inline-block text-sm font-medium text-pencil-red underline underline-offset-2 hover:text-pencil-red-deep"
          >
            Add a note about this run
          </Link>
        ) : (
          <p className="mt-4 text-sm text-sage">
            Effort logged — your coach has what it needs.
          </p>
        )}
      </div>

      <CoachMarginNote
        note={note}
        drivers={readiness.drivers}
        missing={readiness.missing}
        confidence={readiness.confidence}
      />
    </div>
  );
}

function RestDayEntry({
  tomorrow,
  note,
  readiness,
}: {
  tomorrow: TomorrowPreview | null;
  note: string;
  readiness: TodayReadiness;
}) {
  return (
    <div className="grid gap-6 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] sm:items-start">
      <div className="min-w-0">
        <h3 className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xl font-bold leading-tight text-ink sm:text-3xl">
          Recovery is training too
          <span className="stamp text-[11px] font-semibold text-ink-soft">
            Rest day
          </span>
        </h3>
        {tomorrow && (
          <Link
            href={`/dashboard/plan/workout/${tomorrow.id}`}
            className="group mt-4 block max-w-sm py-1"
          >
            <p className="text-sm font-medium text-ink group-hover:text-pencil-red-deep">
              Tomorrow: {tomorrow.title}
              {tomorrow.targetDistanceMeters && (
                <span className="ml-2 font-mono text-xs text-ink-soft">
                  {formatDistance(tomorrow.targetDistanceMeters)}
                </span>
              )}
            </p>
          </Link>
        )}
      </div>

      <CoachMarginNote
        note={note}
        drivers={readiness.drivers}
        missing={readiness.missing}
        confidence={readiness.confidence}
      />
    </div>
  );
}

function NoPlanEntry() {
  return (
    <div>
      <h3 className="text-2xl font-bold leading-tight text-ink sm:text-3xl">
        No active plan
      </h3>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-soft">
        Set a race goal and a plan gets built from your training data —
        schedule, paces, and weekly volume included.
      </p>
      <Link
        href="/dashboard/onboarding"
        className="mt-5 inline-block rounded bg-pencil-red px-4 py-2 text-sm font-semibold text-paper-raised transition-colors hover:bg-pencil-red-deep"
      >
        Start your plan
      </Link>
    </div>
  );
}

function DoneTick() {
  return (
    <svg
      className="pencil-check h-6 w-6 text-sage"
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
}

export function CoachHeartbeat() {
  const { data } = useDashboardToday();

  if (!data || data.state === "no_plan") return null;
  const heartbeat = data.heartbeat;
  const pending = heartbeat?.pending ?? false;

  return (
    <Link
      href="/dashboard/adaptations"
      className={`group flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-1 text-sm transition-colors ${
        pending ? "text-pencil-red" : "text-ink-soft hover:text-ink"
      }`}
    >
      {heartbeat && <span>{heartbeat.message}</span>}
      <span className="font-medium underline-offset-2 group-hover:underline">
        All plan changes →
      </span>
    </Link>
  );
}

function HeroSkeleton() {
  return (
    <section className="rounded-md border border-rule bg-paper-raised p-6">
      <div className="skeleton h-4 w-40" />
      <div className="skeleton mt-5 h-8 w-2/3" />
      <div className="skeleton mt-3 h-4 w-1/3" />
      <div className="skeleton mt-6 h-5 w-1/2" />
    </section>
  );
}
