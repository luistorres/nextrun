"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { GarminConnectButton } from "@/components/garmin/connect-button";
import { Button } from "@/components/ui/button";
import { FitnessSummaryCard } from "@/components/onboarding/fitness-summary-card";
import type { FitnessProfile } from "@/lib/metrics/fitness-profile";

interface GarminConnectStepProps {
  onNext: () => void;
  onGarminConnected: (connected: boolean) => void;
  fetchAndApplyProfile?: () => Promise<void>;
  fitnessProfile?: FitnessProfile | null;
  profileLoading?: boolean;
}

const BACKFILL_POLL_INTERVAL = 5000;
const BACKFILL_TIMEOUT = 60000;

const ANALYSIS_PHASES = [
  { label: "Syncing activity data", duration: 2000 },
  { label: "Calculating training load", duration: 2500 },
  { label: "Computing fitness profile", duration: 3000 },
];

function AnalysisProgress() {
  const [phaseIndex, setPhaseIndex] = useState(0);

  useEffect(() => {
    const phase = ANALYSIS_PHASES[phaseIndex];
    if (!phase || phaseIndex >= ANALYSIS_PHASES.length - 1) return;
    const timer = setTimeout(() => {
      setPhaseIndex((i) => Math.min(i + 1, ANALYSIS_PHASES.length - 1));
    }, phase.duration);
    return () => clearTimeout(timer);
  }, [phaseIndex]);

  return (
    <div className="w-full max-w-sm rounded-md border border-rule bg-paper-shade p-5">
      <div className="space-y-3">
        {ANALYSIS_PHASES.map((phase, idx) => {
          const isActive = idx === phaseIndex;
          const isDone = idx < phaseIndex;

          return (
            <div key={phase.label} className="flex items-center gap-3">
              <div className="flex h-5 w-5 shrink-0 items-center justify-center">
                {isDone ? (
                  <svg
                    className="pencil-check h-4 w-4 text-sage"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M5 12.5l4.2 4.8L19 6.5"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <div
                    className={`h-2 w-2 rounded-full ${
                      isActive ? "bg-ink-soft" : "bg-rule"
                    }`}
                  />
                )}
              </div>

              <span
                className={`text-sm transition-colors duration-300 ${
                  isDone
                    ? "text-sage"
                    : isActive
                      ? "font-medium text-ink"
                      : "text-ink-faint"
                }`}
              >
                {phase.label}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-4 h-px w-full bg-rule">
        <div
          className="h-px bg-sage transition-all duration-1000 ease-out"
          style={{
            width: `${((phaseIndex + 1) / ANALYSIS_PHASES.length) * 100}%`,
          }}
        />
      </div>
    </div>
  );
}

export function GarminConnectStep({
  onNext,
  onGarminConnected,
  fetchAndApplyProfile,
  fitnessProfile,
  profileLoading,
}: GarminConnectStepProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [isPollingBackfill, setIsPollingBackfill] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollStartRef = useRef<number>(0);
  const fetchProfileRef = useRef(fetchAndApplyProfile);
  fetchProfileRef.current = fetchAndApplyProfile;

  const pollBackfill = useCallback(async () => {
    const fetchProfile = fetchProfileRef.current;
    if (!fetchProfile) return;

    const elapsed = Date.now() - pollStartRef.current;
    if (elapsed > BACKFILL_TIMEOUT) {
      setIsPollingBackfill(false);
      try {
        await fetchProfile();
      } catch {
        /* silent */
      }
      return;
    }

    try {
      const res = await fetch("/api/garmin/sync-status");
      if (res.ok) {
        const data = (await res.json()) as { backfillStatus?: string };
        if (data.backfillStatus === "completed") {
          setIsPollingBackfill(false);
          await fetchProfile();
          return;
        }
      }
    } catch {
      /* continue polling */
    }

    pollTimerRef.current = setTimeout(pollBackfill, BACKFILL_POLL_INTERVAL);
  }, []);

  const startBackfillPolling = useCallback(() => {
    if (!fetchProfileRef.current) return;
    setIsPollingBackfill(true);
    pollStartRef.current = Date.now();
    pollBackfill();
  }, [pollBackfill]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/garmin/sync-status");
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          connected: boolean;
          backfillStatus?: string;
        };
        if (cancelled) return;
        setIsConnected(data.connected);
        onGarminConnected(data.connected);

        if (data.connected && fetchProfileRef.current) {
          if (data.backfillStatus === "completed") {
            fetchProfileRef.current().catch(() => {});
          } else {
            startBackfillPolling();
          }
        }
      } catch {
        // Silently fail
      } finally {
        if (!cancelled) setIsChecking(false);
      }
    })();
    return () => {
      cancelled = true;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleConnected = useCallback(() => {
    setIsConnected(true);
    onGarminConnected(true);
    startBackfillPolling();
  }, [onGarminConnected, startBackfillPolling]);

  const showAnalyzing = isPollingBackfill || profileLoading;
  const showProfile = !showAnalyzing && fitnessProfile != null;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-ink">Connect your Garmin</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          Your training history and recovery data become the basis of the plan.
        </p>
      </div>

      <ul className="border-t border-rule">
        {[
          {
            title: "Plans built on your data",
            desc: "VO2 max, heart rate zones, and training history shape the plan",
          },
          {
            title: "Adaptations that track recovery",
            desc: "HRV, sleep, and stress drive weekly adjustments",
          },
          {
            title: "Workouts on your watch",
            desc: "Structured sessions sync to your Garmin device",
          },
        ].map((benefit) => (
          <li key={benefit.title} className="border-b border-rule py-3">
            <p className="text-sm font-medium text-ink">{benefit.title}</p>
            <p className="text-sm text-ink-soft">{benefit.desc}</p>
          </li>
        ))}
      </ul>

      <div className="flex flex-col items-center gap-4">
        {isChecking ? (
          <div className="skeleton h-10 w-40" />
        ) : (
          <GarminConnectButton
            isConnected={isConnected}
            onConnected={handleConnected}
          />
        )}

        {isConnected && showAnalyzing && <AnalysisProgress />}

        {isConnected && showProfile && (
          <div className="w-full max-w-sm">
            <FitnessSummaryCard profile={fitnessProfile!} />
          </div>
        )}

        {isConnected && !showAnalyzing && !showProfile && (
          <p className="text-sm text-sage">
            Garmin connected. Historical data syncs in the background.
          </p>
        )}
      </div>

      <div className="flex justify-between border-t border-rule pt-6">
        <div />
        <div className="flex items-center gap-3">
          {!isConnected && (
            <Button variant="ghost" onClick={onNext}>
              Skip for now
            </Button>
          )}
          {isConnected && (
            <Button
              variant="primary"
              onClick={onNext}
              disabled={showAnalyzing}
              loading={showAnalyzing}
            >
              {showAnalyzing ? "Analyzing" : "Continue"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
