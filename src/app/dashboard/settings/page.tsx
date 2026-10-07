"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { useSession } from "@/hooks/use-session";
import {
  useGoals,
  useActivePlan,
  useFitnessProfile,
  useMetricsSummary,
} from "@/lib/query/hooks";
import { useRegeneratePlan, useDeletePlan } from "@/lib/query/plan-hooks";
import { useGarminStatus, formatRelativeTime } from "@/hooks/use-garmin-status";
import {
  getTrainingPaces,
  formatPace,
} from "@/lib/plan-engine/pace-calculator";
import { GarminConnectButton } from "@/components/garmin/connect-button";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { ProfileSection } from "@/components/settings/profile-section";
import { PreferencesSection } from "@/components/settings/preferences-section";
import { ShoesSection } from "@/components/settings/shoes-section";
import { DangerZone } from "@/components/settings/danger-zone";

const PHASE_LABELS: Record<string, string> = {
  base: "Base",
  build: "Build",
  peak: "Peak",
  taper: "Taper",
  race_week: "Race week",
};

export default function SettingsPage() {
  return (
    <div className="space-y-6 pb-20 lg:pb-0">
      <div>
        <h1 className="text-2xl font-bold text-ink">Settings</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Profile, preferences, training, and connected devices
        </p>
      </div>

      <ProfileSection />
      <PreferencesSection />
      <TrainingGoalSection />
      <TrainingPlanSection />
      <AssumptionsSection />
      <ShoesSection />
      <GarminConnectionSection />
      <AccountSection />
      <DangerZone />
    </div>
  );
}

function TrainingGoalSection() {
  const { data, isLoading, error } = useGoals();

  const activeGoal = data?.goals.find((g) => g.status === "active") ?? null;

  if (isLoading) {
    return <SectionSkeleton />;
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="text-base font-semibold text-ink">Training goal</h2>
        <p className="mt-0.5 text-sm text-ink-soft">
          Your current race or fitness target
        </p>
      </CardHeader>

      <CardContent>
        {error && (
          <div className="rounded-md bg-red-soft px-3 py-2">
            <p className="text-sm text-pencil-red-deep">
              Failed to load goal data. Reload the page to try again.
            </p>
          </div>
        )}

        {!error && !activeGoal && (
          <div>
            <div className="h-8 border-b border-rule" />
            <div className="flex h-8 items-center border-b border-rule">
              <p className="text-sm text-ink-faint">
                No active goal on record.
              </p>
            </div>
            <div className="h-8 border-b border-rule" />
            <p className="mt-3 text-sm text-ink-soft">
              Set a race goal and generate your first training plan.
            </p>
            <Link
              href="/dashboard/onboarding"
              className="mt-3 inline-block rounded bg-pencil-red px-4 py-2 text-sm font-medium text-paper-raised transition-colors duration-150 hover:bg-pencil-red-deep"
            >
              Get started
            </Link>
          </div>
        )}

        {activeGoal && (
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-ink">
                  {activeGoal.raceName || formatGoalType(activeGoal.goalType)}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
                  {activeGoal.raceDate && (
                    <>
                      <span>
                        {new Date(
                          activeGoal.raceDate + "T00:00:00",
                        ).toLocaleDateString("en-US", {
                          month: "long",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </span>
                      <span>&middot;</span>
                    </>
                  )}
                  <span>{formatDistance(activeGoal.targetDistanceMeters)}</span>
                  {activeGoal.targetTimeSeconds && (
                    <>
                      <span>&middot;</span>
                      <span>
                        Target: {formatDuration(activeGoal.targetTimeSeconds)}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <span className="stamp shrink-0 text-xs text-ink-soft">
                {formatGoalType(activeGoal.goalType)}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 border-t border-rule pt-3 sm:grid-cols-2">
              <DetailRow
                label="Training days"
                value={
                  activeGoal.preferredTrainingDays.map(capitalize).join(", ") ||
                  `${activeGoal.trainingDaysPerWeek} days/week`
                }
              />
              <DetailRow
                label="Long run day"
                value={capitalize(activeGoal.preferredLongRunDay)}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TrainingPlanSection() {
  const { data: goalsData } = useGoals();
  const { data: planData, isLoading, error } = useActivePlan();
  const regenerate = useRegeneratePlan();
  const deletePlan = useDeletePlan();
  const [showSuccess, setShowSuccess] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const activeGoal = goalsData?.goals.find((g) => g.status === "active");
  const plan = planData?.plan ?? null;

  useEffect(() => {
    if (!showSuccess) return;
    const timer = setTimeout(() => setShowSuccess(false), 8000);
    return () => clearTimeout(timer);
  }, [showSuccess]);

  const handleRegenerate = () => {
    if (!activeGoal) return;
    setShowSuccess(false);
    regenerate.mutate(
      { goalId: activeGoal.id, isRefinement: true },
      { onSuccess: () => setShowSuccess(true) },
    );
  };

  const handleDelete = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    deletePlan.mutate(undefined, {
      onSettled: () => setConfirmDelete(false),
    });
  };

  if (isLoading) {
    return <SectionSkeleton />;
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="text-base font-semibold text-ink">Training plan</h2>
        <p className="mt-0.5 text-sm text-ink-soft">
          Your current plan status and controls
        </p>
      </CardHeader>

      <CardContent>
        {error && !plan && (
          <div>
            <div className="h-8 border-b border-rule" />
            <div className="flex h-8 items-center border-b border-rule">
              <p className="text-sm text-ink-faint">
                No active plan on record.
              </p>
            </div>
            <div className="h-8 border-b border-rule" />
            <p className="mt-3 text-sm text-ink-soft">
              Complete onboarding to generate your first training plan.
            </p>
            <Link
              href="/dashboard/onboarding"
              className="mt-3 inline-block rounded bg-pencil-red px-4 py-2 text-sm font-medium text-paper-raised transition-colors duration-150 hover:bg-pencil-red-deep"
            >
              Generate plan
            </Link>
          </div>
        )}

        {plan && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p className="text-sm text-ink-faint">Phase</p>
                <span className="stamp mt-1 text-xs text-ink-soft">
                  {PHASE_LABELS[plan.phase] ?? plan.phase}
                </span>
              </div>
              <div>
                <p className="text-sm text-ink-faint">Week</p>
                <p className="mt-1 font-mono text-lg font-bold tabular-nums text-ink">
                  {plan.currentWeek}
                  <span className="text-sm font-normal text-ink-soft">
                    /{plan.totalWeeks}
                  </span>
                </p>
              </div>
              <div>
                <p className="text-sm text-ink-faint">Weekly target</p>
                <p className="mt-1 font-mono text-lg font-bold tabular-nums text-ink">
                  {Number(plan.weeklyMileageTargetKm).toFixed(1)}
                  <span className="ml-0.5 text-sm font-normal text-ink-soft">
                    km
                  </span>
                </p>
              </div>
              <div>
                <p className="text-sm text-ink-faint">Workouts</p>
                <p className="mt-1 font-mono text-lg font-bold tabular-nums text-ink">
                  {plan.workouts.length}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-4">
              <Button
                variant="secondary"
                size="sm"
                loading={regenerate.isPending}
                disabled={!activeGoal || deletePlan.isPending}
                onClick={handleRegenerate}
              >
                Regenerate plan
              </Button>

              {!confirmDelete ? (
                <button
                  type="button"
                  disabled={regenerate.isPending || deletePlan.isPending}
                  onClick={handleDelete}
                  className="text-sm font-medium text-pencil-red-deep transition-colors duration-150 hover:underline disabled:opacity-50"
                >
                  Delete plan
                </button>
              ) : (
                <span className="flex items-center gap-2">
                  <span className="text-sm text-ink-soft">
                    Remove plan and Garmin workouts?
                  </span>
                  <button
                    type="button"
                    disabled={deletePlan.isPending}
                    onClick={handleDelete}
                    className="text-sm font-medium text-pencil-red-deep transition-colors duration-150 hover:underline disabled:opacity-50"
                  >
                    {deletePlan.isPending ? "Removing…" : "Confirm"}
                  </button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={deletePlan.isPending}
                    onClick={() => setConfirmDelete(false)}
                  >
                    Cancel
                  </Button>
                </span>
              )}

              {showSuccess && (
                <span className="text-sm font-medium text-sage">
                  Plan generation started. Refresh in a minute to see updates.
                </span>
              )}
              {regenerate.isError && (
                <span className="text-sm text-pencil-red-deep">
                  Failed to start regeneration. Try again.
                </span>
              )}
              {deletePlan.isError && (
                <span className="text-sm text-pencil-red-deep">
                  Failed to delete plan. Try again.
                </span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AssumptionsSection() {
  const { data: fitnessData, isLoading: fitnessLoading } = useFitnessProfile();
  const { data: metricsData, isLoading: metricsLoading } = useMetricsSummary();

  if (fitnessLoading || metricsLoading) {
    return <SectionSkeleton />;
  }

  const profile = fitnessData?.profile ?? null;
  const baseline = metricsData?.baseline ?? null;

  if (!profile && !baseline) return null;

  const paces = profile ? getTrainingPaces(profile.estimatedVDOT) : null;
  const pace = (secs: number) => formatPace(secs).replace("/km", "");

  return (
    <Card>
      <CardHeader>
        <h2 className="text-base font-semibold text-ink">Assumptions</h2>
        <p className="mt-0.5 text-sm text-ink-soft">
          These drive your readiness and pace calculations.
        </p>
      </CardHeader>

      <CardContent>
        <div className="divide-y divide-rule">
          {profile && (
            <>
              <AssumptionRow
                label="Estimated VDOT"
                value={profile.estimatedVDOT.toFixed(1)}
                detail={`from ${profile.activityCount} runs over ${profile.dataSpanDays} days`}
              />
              <AssumptionRow
                label="Easy pace"
                value={formatPace(profile.avgEasyPaceSecsPerKm)}
                detail="average of your recent easy runs"
              />
              {paces && (
                <AssumptionRow
                  label="Threshold pace"
                  value={`${pace(paces.threshold.min)}–${pace(paces.threshold.max)} /km`}
                  detail="derived from estimated VDOT"
                />
              )}
              {profile.garminVO2Max !== null && (
                <AssumptionRow
                  label="Garmin VO2max"
                  value={profile.garminVO2Max.toFixed(1)}
                />
              )}
            </>
          )}
          {baseline && baseline.dataPoints > 0 && (
            <>
              {baseline.restingHRAvg !== null && (
                <AssumptionRow
                  label="Resting HR baseline"
                  value={`${Math.round(baseline.restingHRAvg)} bpm`}
                  detail="28-day average"
                />
              )}
              <AssumptionRow
                label="Baseline window"
                value={`${formatShortDate(baseline.fromDate)} – ${formatShortDate(baseline.toDate)}`}
                detail={`${baseline.dataPoints} days of data`}
              />
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function AssumptionRow({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-sm text-ink">{label}</p>
        {detail && <p className="text-sm text-ink-faint">{detail}</p>}
      </div>
      <p className="shrink-0 font-mono text-sm tabular-nums text-ink">
        {value}
      </p>
    </div>
  );
}

function GarminConnectionSection() {
  const garmin = useGarminStatus();

  const { syncResult, clearSyncResult } = garmin;
  useEffect(() => {
    if (!syncResult) return;
    const timer = setTimeout(() => clearSyncResult(), 8000);
    return () => clearTimeout(timer);
  }, [syncResult, clearSyncResult]);

  if (garmin.isLoading) {
    return <SectionSkeleton />;
  }

  const totalImported = garmin.syncResult?.imported
    ? garmin.syncResult.imported.activities +
      garmin.syncResult.imported.dailySummaries +
      garmin.syncResult.imported.sleep +
      garmin.syncResult.imported.hrv +
      garmin.syncResult.imported.stress
    : 0;

  return (
    <Card>
      <CardHeader>
        <h2 className="text-base font-semibold text-ink">Garmin connection</h2>
        <p className="mt-0.5 text-sm text-ink-soft">
          Sync activities, sleep, HRV, and stress data
        </p>
      </CardHeader>

      <CardContent>
        {garmin.error && !garmin.status && (
          <div className="rounded-md bg-red-soft px-3 py-2">
            <p className="text-sm text-pencil-red-deep">{garmin.error}</p>
            <button
              type="button"
              onClick={garmin.refetch}
              className="mt-1 text-sm font-medium text-pencil-red-deep underline"
            >
              Retry
            </button>
          </div>
        )}

        {garmin.status?.connected && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="h-2 w-2 shrink-0 rounded-full bg-sage" />
              <div>
                <p className="text-sm font-semibold text-ink">Connected</p>
                <p className="text-sm text-ink-soft">
                  {garmin.status.garminUserId}
                  {garmin.status.lastSyncAt && (
                    <span>
                      {" "}
                      &middot; last synced{" "}
                      {formatRelativeTime(garmin.status.lastSyncAt)}
                    </span>
                  )}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-rule pt-3">
              <span className="mr-1 text-sm text-ink-faint">Sync</span>
              <Button
                variant="secondary"
                size="sm"
                loading={garmin.isSyncing}
                onClick={() => garmin.handleSync(7)}
              >
                7 days
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={garmin.isSyncing}
                onClick={() => garmin.handleSync(30)}
              >
                30 days
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={garmin.isSyncing}
                onClick={() => garmin.handleSync(90)}
              >
                90 days
              </Button>
            </div>

            {garmin.syncResult && (
              <div>
                {garmin.syncResult.success && garmin.syncResult.imported ? (
                  <div className="rounded-md bg-sage-soft px-3 py-2">
                    <p className="text-sm font-medium text-sage">
                      {totalImported} records synced
                    </p>
                  </div>
                ) : (
                  <div className="rounded-md bg-red-soft px-3 py-2">
                    <p className="text-sm text-pencil-red-deep">
                      {garmin.syncResult.error || "Sync failed. Try again."}
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="border-t border-rule pt-3">
              <button
                type="button"
                disabled={garmin.isDisconnecting}
                onClick={garmin.handleDisconnect}
                className="text-sm font-medium text-pencil-red-deep transition-colors duration-150 hover:underline disabled:opacity-50"
              >
                {garmin.isDisconnecting
                  ? "Disconnecting…"
                  : "Disconnect Garmin"}
              </button>
            </div>
          </div>
        )}

        {!garmin.status?.connected && !garmin.error && (
          <div>
            <p className="mb-4 text-sm text-ink-soft">
              Connect your Garmin account to sync activities, sleep, HRV, and
              stress data for plan adaptation.
            </p>
            <GarminConnectButton
              isConnected={false}
              onConnected={garmin.refetch}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AccountSection() {
  const { data: session } = useSession();

  return (
    <Card>
      <CardHeader>
        <h2 className="text-base font-semibold text-ink">Account</h2>
        <p className="mt-0.5 text-sm text-ink-soft">
          Your profile and session
        </p>
      </CardHeader>

      <CardContent>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-paper-shade text-sm font-medium text-ink-soft">
              {session?.user?.email?.[0]?.toUpperCase() ?? "U"}
            </div>
            <div>
              <p className="text-sm font-medium text-ink">
                {session?.user?.email ?? "User"}
              </p>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => signOut({ callbackUrl: "/login" })}
          >
            Sign out
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SectionSkeleton({ height = "h-40" }: { height?: string } = {}) {
  return <div className={`skeleton ${height} rounded-md`} />;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm text-ink-faint">{label}</p>
      <p className="mt-0.5 text-sm text-ink">{value}</p>
    </div>
  );
}

function formatGoalType(type: string): string {
  return type
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${meters} m`;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatShortDate(iso: string): string {
  return new Date(iso + (iso.length === 10 ? "T00:00:00" : "")).toLocaleDateString(
    "en-US",
    { month: "short", day: "numeric" },
  );
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
