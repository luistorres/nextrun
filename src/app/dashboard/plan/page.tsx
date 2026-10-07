"use client";

import { useState } from "react";
import Link from "next/link";
import { useActivePlan, usePlanActivities } from "@/lib/query/hooks";
import { PlanCalendar } from "@/components/plan/calendar";
import type { PlanPhase } from "@/types/plan";

const PHASE_LABELS: Record<string, string> = {
  base: "Base",
  build: "Build",
  peak: "Peak",
  taper: "Taper",
  race_week: "Race week",
};

const PHASE_ORDER: PlanPhase[] = ["base", "build", "peak", "taper", "race_week"];

export default function PlanPage() {
  const { data, isLoading, error } = useActivePlan();
  const { data: activityData } = usePlanActivities();

  if (isLoading) {
    return (
      <div className="space-y-6 pb-20 lg:pb-0">
        <h1 className="text-2xl font-bold text-ink">Plan</h1>
        <LoadingSkeleton />
      </div>
    );
  }

  if (error || !data?.plan) {
    return (
      <div className="space-y-6 pb-20 lg:pb-0">
        <h1 className="text-2xl font-bold text-ink">Plan</h1>
        <div className="rounded-md border border-rule bg-paper-raised">
          {[0, 1, 2].map((i) => (
            <div key={i} className="border-b border-rule px-5 py-3">
              <div className="h-4 w-2/5 rounded-sm bg-paper-shade" />
            </div>
          ))}
          <div className="px-5 py-6">
            <h3 className="text-base font-semibold text-ink">No active plan</h3>
            <p className="mt-1 max-w-prose text-sm text-ink-soft">
              Set a race goal and a plan gets written from your training data —
              schedule, paces, and weekly volume included.
            </p>
            <Link
              href="/dashboard/onboarding"
              className="mt-4 inline-block rounded bg-pencil-red px-4 py-2 text-sm font-semibold text-paper-raised transition-colors hover:bg-pencil-red-deep"
            >
              Start your plan
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const plan = data.plan;
  const planActivities = activityData?.activities ?? [];
  const firstWorkout = plan.workouts[0];
  const planStartDate =
    firstWorkout?.scheduledDate ?? new Date().toISOString().split("T")[0];

  return (
    <div className="space-y-6 pb-20 lg:pb-0">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold text-ink">Plan</h1>
        <Link
          href="/dashboard/adaptations"
          className="text-sm font-medium text-ink-soft underline-offset-2 transition-colors hover:text-ink hover:underline"
        >
          Plan changes →
        </Link>
      </div>

      <section className="rounded-md border border-rule bg-paper-raised px-5 py-4 shadow-[0_1px_4px_rgba(38,36,31,0.06)] sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="text-lg font-bold text-ink">
            {plan.goal.raceName ?? "Training plan"}
          </h2>
          <p className="font-mono text-sm tabular-nums text-ink-soft">
            {[
              plan.goal.raceDate
                ? new Date(plan.goal.raceDate + "T00:00:00").toLocaleDateString(
                    "en-GB",
                    { day: "numeric", month: "long", year: "numeric" },
                  )
                : null,
              plan.goal.targetDistanceMeters >= 1000
                ? `${(plan.goal.targetDistanceMeters / 1000).toFixed(1)} km`
                : `${plan.goal.targetDistanceMeters} m`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>

        <PhaseLine
          currentPhase={plan.phase}
          currentWeek={plan.currentWeek}
          totalWeeks={plan.totalWeeks}
        />
      </section>

      <section className="rounded-md border border-rule bg-paper-raised shadow-[0_1px_4px_rgba(38,36,31,0.06)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-4 py-3 sm:px-5">
          <p className="text-sm font-semibold text-ink">
            Training log
            <span className="ml-2 font-normal text-ink-faint">
              {plan.totalWeeks} weeks · {plan.workouts.length} workouts
            </span>
          </p>
          <SyncToGarminButton />
        </div>
        <PlanCalendar
          workouts={plan.workouts}
          activities={planActivities}
          planStartDate={planStartDate}
          totalWeeks={plan.totalWeeks}
          currentWeek={plan.currentWeek}
        />
      </section>
    </div>
  );
}

function PhaseLine({
  currentPhase,
  currentWeek,
  totalWeeks,
}: {
  currentPhase: string;
  currentWeek: number;
  totalWeeks: number;
}) {
  const currentPhaseIndex = PHASE_ORDER.indexOf(currentPhase as PlanPhase);
  const progress = Math.min((currentWeek / totalWeeks) * 100, 100);

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        {PHASE_ORDER.map((phase, idx) => {
          const isActive = phase === currentPhase;
          if (isActive) {
            return (
              <span key={phase} className="stamp text-[11px] text-pencil-red">
                {PHASE_LABELS[phase]}
              </span>
            );
          }
          return (
            <span
              key={phase}
              className={`text-xs ${
                idx < currentPhaseIndex ? "text-ink-soft" : "text-ink-faint"
              }`}
            >
              {PHASE_LABELS[phase]}
            </span>
          );
        })}
        <span className="ml-auto font-mono text-xs tabular-nums text-ink-faint">
          Week {currentWeek} of {totalWeeks}
        </span>
      </div>
      <div className="mt-2 h-px w-full bg-rule">
        <div
          className="h-[2px] -translate-y-px bg-ink-soft transition-all duration-200"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

type SyncState = "idle" | "syncing" | "success" | "error";

function SyncToGarminButton() {
  const [state, setState] = useState<SyncState>("idle");
  const [syncCount, setSyncCount] = useState(0);

  async function handleSync() {
    if (state === "syncing") return;
    setState("syncing");

    try {
      const res = await fetch("/api/plan/sync", { method: "POST" });
      const data = (await res.json()) as { count?: number; error?: string };

      if (!res.ok) {
        setState("error");
        setTimeout(() => setState("idle"), 3000);
        return;
      }

      setSyncCount(data.count ?? 0);
      setState("success");
      setTimeout(() => setState("idle"), 4000);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 3000);
    }
  }

  const label =
    state === "syncing"
      ? "Pushing to Garmin…"
      : state === "success"
        ? syncCount > 0
          ? `${syncCount} workouts synced`
          : "All workouts synced"
        : state === "error"
          ? "Sync failed — try again"
          : "Sync all to Garmin";

  return (
    <button
      onClick={handleSync}
      disabled={state === "syncing"}
      className={`rounded border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-wait ${
        state === "success"
          ? "border-rule bg-sage-soft text-sage"
          : state === "error"
            ? "border-rule bg-amber-soft text-amber-pencil"
            : "border-rule-strong text-ink-soft hover:bg-paper-shade hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="skeleton h-28 w-full" />
      <div className="skeleton h-96 w-full" />
    </div>
  );
}
