"use client";

import { useState, useEffect, useRef } from "react";

const PROGRESS_MESSAGES = [
  "Reading your fitness profile",
  "Calculating training zones",
  "Laying out periodization phases",
  "Structuring the weeks",
  "Placing recovery windows",
  "Writing the workouts",
  "Finishing the plan",
];

interface GeneratingStepProps {
  onPlanReady: () => void;
  goalId: string | null;
}

type PlanState = "exists" | "absent" | "unknown";

async function checkPlanState(): Promise<PlanState> {
  try {
    const res = await fetch("/api/plan");
    if (res.status === 404) return "absent";
    if (!res.ok) return "unknown";
    const data = (await res.json()) as { plan?: unknown };
    return data.plan ? "exists" : "absent";
  } catch {
    return "unknown";
  }
}

export function GeneratingStep({ onPlanReady, goalId }: GeneratingStepProps) {
  const [messageIndex, setMessageIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const notFoundCountRef = useRef(0);
  const completedNoPlanCountRef = useRef(0);
  const retryInFlightRef = useRef(false);
  const tickInFlightRef = useRef(false);

  useEffect(() => {
    if (failed !== null) return;
    const timer = setInterval(() => {
      setMessageIndex((prev) => {
        if (prev < PROGRESS_MESSAGES.length - 1) return prev + 1;
        return prev;
      });
    }, 3000);

    return () => clearInterval(timer);
  }, [failed, retryNonce]);

  useEffect(() => {
    if (failed !== null) return;
    const timer = setInterval(() => {
      setProgress((prev) => {
        // Slow down as we approach 90% — never fully complete until plan is ready
        if (prev >= 90) return prev;
        const increment = prev < 50 ? 2 : prev < 75 ? 1 : 0.5;
        return Math.min(prev + increment, 90);
      });
    }, 500);

    return () => clearInterval(timer);
  }, [failed, retryNonce]);

  useEffect(() => {
    if (failed !== null) return;
    let cancelled = false;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    const tick = async () => {
      if (tickInFlightRef.current) return;
      tickInFlightRef.current = true;
      try {
        await runTick();
      } finally {
        tickInFlightRef.current = false;
      }
    };

    const runTick = async () => {
      const planState = await checkPlanState();
      if (cancelled) return;

      if (planState === "exists") {
        setProgress(100);
        setTimeout(() => {
          if (!cancelled) onPlanReady();
        }, 800);
        return;
      }

      let status = "queued";
      let error: string | undefined;
      try {
        const res = await fetch(
          `/api/plan/generate/status${goalId ? `?goalId=${goalId}` : ""}`,
        );
        if (res.ok) {
          const data = (await res.json()) as {
            status: string;
            error?: string;
          };
          status = data.status;
          error = data.error;
        }
      } catch {
        // Keep waiting — a blip is not a failure
      }
      if (cancelled) return;

      if (status === "failed") {
        setFailed(error ?? "Plan generation failed");
        return;
      }

      if (status === "not_found") {
        notFoundCountRef.current += 1;
        if (notFoundCountRef.current >= 6 && planState === "absent") {
          setFailed("Plan generation did not start.");
          return;
        }
      } else {
        notFoundCountRef.current = 0;
      }

      if (status === "completed" && planState === "absent") {
        completedNoPlanCountRef.current += 1;
        if (completedNoPlanCountRef.current >= 2) {
          setFailed("Plan generation finished without a plan.");
        }
      } else {
        completedNoPlanCountRef.current = 0;
      }
    };

    const startTimer = setTimeout(() => {
      tick();
      pollInterval = setInterval(tick, 5000);
    }, 3000);

    return () => {
      cancelled = true;
      clearTimeout(startTimer);
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [onPlanReady, goalId, failed, retryNonce]);

  const retry = async () => {
    if (!goalId || retryInFlightRef.current) return;
    retryInFlightRef.current = true;
    setRetrying(true);

    try {
      // Fail closed: the POST supersedes any active plan and deletes its
      // Garmin workouts, so only a CONFIRMED plan-absent check may re-POST —
      // a transient blip stays on the failed screen.
      const planState = await checkPlanState();
      if (planState === "exists") {
        onPlanReady();
        return;
      }
      if (planState === "unknown") {
        setRetrying(false);
        return;
      }

      let ok = false;
      try {
        const res = await fetch("/api/plan/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ goalId }),
        });
        ok = res.ok;
      } catch {
        ok = false;
      }
      if (!ok) {
        setRetrying(false);
        return;
      }

      notFoundCountRef.current = 0;
      completedNoPlanCountRef.current = 0;
      setProgress(0);
      setMessageIndex(0);
      setFailed(null);
      setRetrying(false);
      setRetryNonce((n) => n + 1);
    } finally {
      retryInFlightRef.current = false;
    }
  };

  if (failed) {
    return (
      <div className="flex flex-col items-center space-y-6 py-8 text-center">
        <div>
          <h2 className="text-2xl font-bold text-ink">
            Plan generation failed
          </h2>
          <p className="mt-2 text-sm text-ink-soft">
            Something went wrong while writing your plan. Your data is fine —
            you can try again.
          </p>
        </div>
        {goalId ? (
          <button
            type="button"
            onClick={retry}
            disabled={retrying}
            className="rounded-md border border-rule-strong px-4 py-2 text-sm font-medium text-ink hover:bg-paper disabled:opacity-50"
          >
            {retrying ? "Restarting" : "Try again"}
          </button>
        ) : (
          <p className="text-sm text-ink-soft">Go back and try again.</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center space-y-10 py-8">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-ink">Writing your plan</h2>
        <p className="mt-2 text-sm text-ink-soft">
          Your coach is working through your data. This takes a minute.
        </p>
      </div>

      <div className="w-full max-w-md">
        <div className="h-px w-full bg-rule">
          <div
            className="h-px bg-sage transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="mt-3 text-center text-sm text-ink-soft">
          {progress < 100 ? PROGRESS_MESSAGES[messageIndex] : "Plan ready."}
        </p>
      </div>

      <div className="w-full max-w-md border-l border-rule-strong py-1 pl-4">
        <p className="text-sm font-medium text-ink">While you wait</p>
        <p className="mt-1 text-sm leading-relaxed text-ink-soft">
          The plan follows the 80/20 principle: about 80% of your runs sit at
          an easy, conversational pace. That builds aerobic fitness while
          keeping the load sustainable.
        </p>
      </div>
    </div>
  );
}
