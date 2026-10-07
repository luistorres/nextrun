"use client";

import { use, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  useWorkoutDetail,
  useUpdateWorkoutStatus,
  useSkipWorkout,
  useRescheduleWorkout,
  useSyncWorkout,
  useSubmitWorkoutFeedback,
  useWorkoutFeedback,
} from "@/lib/query/plan-hooks";
import type {
  WorkoutStep,
  SimpleWorkoutStep,
  IntervalWorkoutStep,
} from "@/types/plan";
import { decimalMinPerKmToDisplay } from "@/lib/utils/pace";
import { ExecutionPanel } from "@/components/plan/execution-quality";
import { RPECapture } from "@/components/plan/rpe-capture";
import { FeedbackModal } from "@/components/plan/feedback-modal";
import type { FeedbackData } from "@/components/plan/feedback-modal";
import { WorkoutActions } from "@/components/plan/workout-actions";

export default function WorkoutDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  return <WorkoutDetailContent workoutId={id} />;
}

function WorkoutDetailContent({ workoutId }: { workoutId: string }) {
  const { data, isLoading, error } = useWorkoutDetail(workoutId);
  const statusMutation = useUpdateWorkoutStatus();
  const skipMutation = useSkipWorkout();
  const rescheduleMutation = useRescheduleWorkout();
  const syncMutation = useSyncWorkout();
  const feedbackMutation = useSubmitWorkoutFeedback();
  const { data: feedbackData } = useWorkoutFeedback(workoutId);
  const [showRpe, setShowRpe] = useState(false);
  const [rpeDismissed, setRpeDismissed] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);

  if (isLoading) {
    return (
      <div className="space-y-6 pb-20 lg:pb-0">
        <BackLink />
        <LoadingSkeleton />
      </div>
    );
  }

  if (error || !data?.workout) {
    return (
      <div className="space-y-6 pb-20 lg:pb-0">
        <BackLink />
        <div className="rounded-md border border-rule bg-paper-raised px-6 py-8">
          <p className="text-sm text-ink-soft">
            This workout could not be found. It may belong to another account or
            an older plan — head back to the plan and pick it from there.
          </p>
        </div>
      </div>
    );
  }

  const workout = data.workout;
  const isActionDisabled =
    statusMutation.isPending ||
    skipMutation.isPending ||
    rescheduleMutation.isPending ||
    syncMutation.isPending;

  return (
    <div className="space-y-6 pb-20 lg:pb-0">
      <BackLink />

      <section className="overflow-hidden rounded-md border border-rule bg-paper-raised shadow-[0_1px_4px_rgba(38,36,31,0.06)]">
        <div className="log-sheet pb-5 pl-10 pr-5 pt-4 sm:pl-12 sm:pr-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h1 className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xl font-bold leading-tight text-ink sm:text-3xl">
              {workout.title}
              <span className="stamp text-[11px] font-semibold text-ink-soft">
                {formatWorkoutType(workout.workoutType)}
              </span>
            </h1>
            <CompletionStamp status={workout.completionStatus} />
          </div>

          <p className="mt-2 text-sm text-ink-soft">
            {formatFullDate(workout.scheduledDate)} · Week{" "}
            {workout.plan.currentWeek} of {workout.plan.totalWeeks} ·{" "}
            <span className="capitalize">{workout.plan.phase}</span> phase
          </p>

          <p className="mt-3 font-mono text-sm tabular-nums text-ink-soft">
            {[
              workout.targetDistanceMeters
                ? formatDistance(workout.targetDistanceMeters)
                : null,
              workout.targetDurationSeconds
                ? formatDuration(workout.targetDurationSeconds)
                : null,
              workout.targetPaceMinPerKm
                ? `${decimalMinPerKmToDisplay(workout.targetPaceMinPerKm)}/km`
                : null,
              workout.targetHeartRateZone
                ? `Zone ${workout.targetHeartRateZone}`
                : null,
            ]
              .filter(Boolean)
              .join("  ·  ")}
          </p>

          {workout.description && (
            <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-soft">
              {workout.description}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule px-5 py-3 sm:px-7">
          <SyncStatusIndicator
            syncStatus={workout.syncStatus}
            garminWorkoutId={workout.garminWorkoutId}
          />
          <Button
            variant="outline"
            size="sm"
            loading={syncMutation.isPending}
            disabled={isActionDisabled}
            onClick={() => syncMutation.mutate(workoutId)}
          >
            Sync to Garmin
          </Button>
        </div>
      </section>

      {workout.completionStatus === "completed" && workout.completedActivity && (
        <ExecutionPanel
          planned={{
            targetDistanceMeters: workout.targetDistanceMeters,
            targetDurationSeconds: workout.targetDurationSeconds,
            targetPaceMinPerKm: workout.targetPaceMinPerKm,
          }}
          actual={workout.completedActivity}
          linkedActivityCount={workout.linkedActivityCount}
        />
      )}

      {workout.workoutSteps && workout.workoutSteps.length > 0 && (
        <section className="rounded-md border border-rule bg-paper-raised shadow-[0_1px_4px_rgba(38,36,31,0.06)]">
          <div className="border-b border-rule px-5 py-3 sm:px-7">
            <h2 className="text-sm font-semibold text-ink">Structure</h2>
          </div>
          <StepsTable steps={workout.workoutSteps} />
        </section>
      )}

      {workout.completionStatus === "skipped" && workout.skipReason && (
        <section className="rounded-md border border-rule bg-amber-soft px-5 py-4 sm:px-7">
          <h2 className="text-sm font-semibold text-amber-pencil">Skipped</h2>
          <p className="mt-1 max-w-prose text-sm leading-relaxed text-ink-soft">
            {workout.skipReason}
          </p>
        </section>
      )}

      <section className="rounded-md border border-rule bg-paper-raised px-5 py-4 shadow-[0_1px_4px_rgba(38,36,31,0.06)] sm:px-7">
        <div className="flex flex-wrap gap-3">
          <Button
            variant="primary"
            disabled={isActionDisabled || workout.completionStatus === "completed"}
            loading={
              statusMutation.isPending &&
              statusMutation.variables?.status === "completed"
            }
            onClick={() => {
              if (workout.completionStatus !== "completed") {
                setShowRpe(true);
              }
            }}
          >
            Mark completed
          </Button>
          <Button
            variant="outline"
            disabled={isActionDisabled || workout.completionStatus === "partial"}
            loading={
              statusMutation.isPending &&
              statusMutation.variables?.status === "partial"
            }
            onClick={() =>
              statusMutation.mutate({ workoutId, status: "partial" })
            }
          >
            Mark partial
          </Button>
          {workout.completionStatus !== "pending" && (
            <Button
              variant="ghost"
              disabled={isActionDisabled}
              loading={
                statusMutation.isPending &&
                statusMutation.variables?.status === "pending"
              }
              onClick={() => {
                setShowRpe(false);
                setRpeDismissed(false);
                statusMutation.mutate({ workoutId, status: "pending" });
              }}
            >
              Reset to pending
            </Button>
          )}
        </div>

        {/* Shown after Mark completed, or when Garmin auto-completed without an RPE */}
        {!rpeDismissed &&
          (showRpe ||
            (workout.completionStatus === "completed" &&
              workout.rpeScore == null)) && (
            <RPECapture
              isLoading={statusMutation.isPending}
              onSave={(rpeScore, perceivedDifficulty) => {
                statusMutation.mutate(
                  {
                    workoutId,
                    status: "completed",
                    rpeScore,
                    perceivedDifficulty,
                  },
                  {
                    onSuccess: () => {
                      setShowRpe(false);
                      setRpeDismissed(true);
                    },
                  },
                );
              }}
              onSkip={() => {
                if (workout.completionStatus === "completed") {
                  setRpeDismissed(true);
                } else {
                  statusMutation.mutate(
                    { workoutId, status: "completed" },
                    { onSuccess: () => setRpeDismissed(true) },
                  );
                }
              }}
            />
          )}

        <div className="mt-4">
          <WorkoutActions
            completionStatus={workout.completionStatus}
            onSkip={(reason) => skipMutation.mutate({ workoutId, reason })}
            onReschedule={(newDate) =>
              rescheduleMutation.mutate({ workoutId, newDate })
            }
            isSkipping={skipMutation.isPending}
            isRescheduling={rescheduleMutation.isPending}
          />
        </div>

        {(workout.completionStatus === "completed" ||
          workout.completionStatus === "skipped") && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-4">
            <div>
              <p className="text-sm font-medium text-ink">
                {feedbackData?.feedback
                  ? "Note logged"
                  : "Add a note about this run"}
              </p>
              <p className="mt-0.5 text-xs text-ink-faint">
                {feedbackData?.feedback
                  ? "You can revise it any time."
                  : "Mood, pain, stressors — all optional."}
              </p>
            </div>
            <Button
              variant={feedbackData?.feedback ? "outline" : "secondary"}
              size="sm"
              onClick={() => setShowFeedback(true)}
            >
              {feedbackData?.feedback ? "Revise note" : "Add note"}
            </Button>
          </div>
        )}
      </section>

      <FeedbackModal
        open={showFeedback}
        onClose={() => setShowFeedback(false)}
        isLoading={feedbackMutation.isPending}
        feedbackType={
          workout.completionStatus === "skipped" ? "skip_reason" : "post_workout"
        }
        workoutTitle={workout.title}
        onSubmit={(feedbackPayload: FeedbackData) => {
          feedbackMutation.mutate(
            {
              workoutId,
              sentiment: feedbackPayload.sentiment,
              contextualNotes: feedbackPayload.contextualNotes,
              painAreas: feedbackPayload.painAreas,
              externalStressors: feedbackPayload.externalStressors,
              feedbackType: feedbackPayload.feedbackType,
              reasonForMiss: feedbackPayload.reasonForMiss,
            },
            { onSuccess: () => setShowFeedback(false) },
          );
        }}
      />
    </div>
  );
}

function StepsTable({ steps }: { steps: WorkoutStep[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full font-mono text-sm tabular-nums">
        <tbody>
          {steps.flatMap((step, idx) => {
            if (step.type === "interval") {
              const s = step as IntervalWorkoutStep;
              return [
                <StepRow
                  key={`${idx}-head`}
                  label={`Intervals ×${s.repeatCount}`}
                  detail={step.description ?? null}
                  amount=""
                  pace=""
                />,
                <StepRow
                  key={`${idx}-work`}
                  label="Work"
                  indent
                  amount={formatStepDuration(
                    s.workStep.durationType,
                    s.workStep.durationValue,
                  )}
                  pace={formatStepPace(s.workStep)}
                />,
                <StepRow
                  key={`${idx}-rest`}
                  label="Rest"
                  indent
                  amount={formatStepDuration(
                    s.restStep.durationType,
                    s.restStep.durationValue,
                  )}
                  pace=""
                />,
              ];
            }
            const s = step as SimpleWorkoutStep;
            return [
              <StepRow
                key={idx}
                label={stepLabel(step.type)}
                detail={step.description ?? null}
                amount={formatStepDuration(s.durationType, s.durationValue)}
                pace={formatStepPace(s)}
              />,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

function StepRow({
  label,
  detail,
  amount,
  pace,
  indent = false,
}: {
  label: string;
  detail?: string | null;
  amount: string;
  pace: string;
  indent?: boolean;
}) {
  return (
    <tr className="border-b border-rule last:border-b-0">
      <td
        className={`py-2.5 pr-4 font-sans text-sm text-ink ${
          indent ? "pl-9 text-ink-soft sm:pl-12" : "pl-5 font-medium sm:pl-7"
        }`}
      >
        {label}
        {detail && (
          <span className="mt-0.5 block max-w-prose text-xs font-normal text-ink-faint">
            {detail}
          </span>
        )}
      </td>
      <td className="whitespace-nowrap py-2.5 pr-4 text-right text-xs text-ink-soft">
        {amount}
      </td>
      <td className="whitespace-nowrap py-2.5 pr-5 text-right text-xs text-ink-soft sm:pr-7">
        {pace}
      </td>
    </tr>
  );
}

function BackLink() {
  return (
    <Link
      href="/dashboard/plan"
      className="inline-flex items-center gap-1 text-sm text-ink-soft transition-colors hover:text-ink"
    >
      <svg
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15.75 19.5 8.25 12l7.5-7.5"
        />
      </svg>
      Back to plan
    </Link>
  );
}

function CompletionStamp({ status }: { status: string }) {
  switch (status) {
    case "completed":
      return <span className="stamp text-[11px] text-sage">Done</span>;
    case "skipped":
      return <span className="stamp text-[11px] text-amber-pencil">Skipped</span>;
    case "partial":
      return <span className="stamp text-[11px] text-amber-pencil">Partial</span>;
    default:
      return <span className="stamp text-[11px] text-ink-faint">Planned</span>;
  }
}

function SyncStatusIndicator({
  syncStatus,
  garminWorkoutId,
}: {
  syncStatus: string;
  garminWorkoutId: string | null;
}) {
  const config =
    syncStatus === "synced"
      ? { label: "Synced to Garmin", className: "text-sage" }
      : syncStatus === "syncing"
        ? { label: "Syncing…", className: "text-ink-soft" }
        : syncStatus === "failed"
          ? { label: "Sync failed — retry below", className: "text-amber-pencil" }
          : { label: "Not synced", className: "text-ink-faint" };

  return (
    <p className={`text-xs ${config.className}`}>
      {config.label}
      {garminWorkoutId && (
        <span className="ml-2 font-mono text-[11px] text-ink-faint">
          {garminWorkoutId}
        </span>
      )}
    </p>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="skeleton h-48 w-full" />
      <div className="skeleton h-64 w-full" />
      <div className="skeleton h-24 w-full" />
    </div>
  );
}

function stepLabel(type: string): string {
  switch (type) {
    case "warmup":
      return "Warm-up";
    case "cooldown":
      return "Cool-down";
    case "steady":
      return "Steady";
    case "interval":
      return "Intervals";
    default:
      return type;
  }
}

function formatWorkoutType(type: string): string {
  return type
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatFullDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${meters} m`;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m} min`;
}

function formatStepDuration(
  durationType: string,
  durationValue?: number,
): string {
  if (!durationValue) return "Open";

  if (durationType === "time") {
    const m = Math.floor(durationValue / 60);
    const s = durationValue % 60;
    if (s > 0) return `${m}:${String(s).padStart(2, "0")}`;
    return `${m} min`;
  }

  if (durationType === "distance") {
    if (durationValue >= 1000) return `${(durationValue / 1000).toFixed(1)} km`;
    return `${durationValue} m`;
  }

  return "Open";
}

function formatStepPace(step: {
  targetType?: string;
  targetMin?: number | null;
  targetMax?: number | null;
}): string {
  if (
    step.targetType === "pace" &&
    step.targetMin != null &&
    step.targetMax != null
  ) {
    return `${formatPace(step.targetMin)}–${formatPace(step.targetMax)}/km`;
  }
  return "";
}

function formatPace(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
