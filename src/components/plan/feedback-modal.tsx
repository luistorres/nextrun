"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { PainSeverity } from "@/lib/db/schema/training";

type Sentiment =
  | "feeling_great"
  | "feeling_good"
  | "feeling_okay"
  | "feeling_tired"
  | "feeling_terrible";

interface PainEntry {
  area: string;
  severity: PainSeverity;
}

export interface FeedbackData {
  sentiment?: Sentiment;
  contextualNotes?: string;
  painAreas?: PainEntry[];
  externalStressors?: string[];
  feedbackType: "post_workout" | "skip_reason" | "general";
  reasonForMiss?: string;
}

interface FeedbackModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: FeedbackData) => void;
  isLoading?: boolean;
  feedbackType?: "post_workout" | "skip_reason" | "general";
  workoutTitle?: string;
}

const SENTIMENTS: { value: Sentiment; label: string }[] = [
  { value: "feeling_great", label: "Great" },
  { value: "feeling_good", label: "Good" },
  { value: "feeling_okay", label: "Okay" },
  { value: "feeling_tired", label: "Tired" },
  { value: "feeling_terrible", label: "Terrible" },
];

const PAIN_AREAS = [
  "Knees",
  "Ankles",
  "Hips",
  "Back",
  "Calves",
  "Shins",
  "Feet",
  "Other",
];

const STRESSORS = [
  "Work stress",
  "Poor sleep",
  "Travel",
  "Illness",
  "Weather",
  "Other",
];

function chipClasses(selected: boolean): string {
  return selected
    ? "border-rule-strong bg-paper-shade text-ink"
    : "border-rule bg-paper-raised text-ink-soft hover:text-ink";
}

export function FeedbackModal(props: FeedbackModalProps) {
  // Form state lives in FeedbackModalContent, which mounts fresh each time
  // the modal opens — so every open starts with a blank form without
  // resetting state inside an effect.
  if (!props.open) return null;
  return <FeedbackModalContent {...props} />;
}

function FeedbackModalContent({
  onClose,
  onSubmit,
  isLoading = false,
  feedbackType = "post_workout",
  workoutTitle,
}: FeedbackModalProps) {
  const [sentiment, setSentiment] = useState<Sentiment | undefined>();
  const [notes, setNotes] = useState("");
  const [reasonForMiss, setReasonForMiss] = useState("");
  const [selectedPainAreas, setSelectedPainAreas] = useState<
    Map<string, PainSeverity>
  >(new Map());
  const [selectedStressors, setSelectedStressors] = useState<Set<string>>(
    new Set(),
  );
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const togglePainArea = useCallback((area: string) => {
    setSelectedPainAreas((prev) => {
      const next = new Map(prev);
      if (next.has(area)) {
        next.delete(area);
      } else {
        next.set(area, "mild");
      }
      return next;
    });
  }, []);

  const setPainSeverity = useCallback(
    (area: string, severity: PainSeverity) => {
      setSelectedPainAreas((prev) => {
        const next = new Map(prev);
        next.set(area, severity);
        return next;
      });
    },
    [],
  );

  const toggleStressor = useCallback((stressor: string) => {
    setSelectedStressors((prev) => {
      const next = new Set(prev);
      if (next.has(stressor)) {
        next.delete(stressor);
      } else {
        next.add(stressor);
      }
      return next;
    });
  }, []);

  const handleSubmit = useCallback(() => {
    const painAreas: PainEntry[] = [];
    for (const [area, severity] of selectedPainAreas) {
      painAreas.push({ area, severity });
    }

    onSubmit({
      sentiment,
      contextualNotes: notes.trim() || undefined,
      painAreas: painAreas.length > 0 ? painAreas : undefined,
      externalStressors:
        selectedStressors.size > 0 ? Array.from(selectedStressors) : undefined,
      feedbackType,
      reasonForMiss:
        feedbackType === "skip_reason" && reasonForMiss.trim()
          ? reasonForMiss.trim()
          : undefined,
    });
  }, [
    sentiment,
    notes,
    selectedPainAreas,
    selectedStressors,
    feedbackType,
    reasonForMiss,
    onSubmit,
  ]);

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center"
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Workout note"
    >
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-md border border-rule bg-paper-raised sm:rounded-md">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-rule bg-paper-raised px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-ink">
              {feedbackType === "skip_reason"
                ? "Why did you skip?"
                : "How did it go?"}
            </h2>
            {workoutTitle && (
              <p className="mt-0.5 text-xs text-ink-soft">{workoutTitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1.5 text-ink-soft transition-colors hover:bg-paper-shade hover:text-ink"
            aria-label="Close"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18 18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="space-y-6 p-6">
          {feedbackType === "skip_reason" && (
            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-ink-faint">
                Reason
              </label>
              <textarea
                value={reasonForMiss}
                onChange={(e) => setReasonForMiss(e.target.value)}
                placeholder="What happened?"
                maxLength={500}
                rows={2}
                className="w-full resize-none rounded border border-rule bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint"
              />
            </div>
          )}

          <div>
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-faint">
              How are you feeling?
            </p>
            <div className="flex gap-2">
              {SENTIMENTS.map((s) => {
                const isSelected = sentiment === s.value;
                return (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => setSentiment(isSelected ? undefined : s.value)}
                    className={`flex-1 rounded border py-2.5 text-xs font-medium transition-colors duration-150 ${chipClasses(isSelected)}`}
                    aria-pressed={isSelected}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-faint">
              Any pain or discomfort?
            </p>
            <div className="flex flex-wrap gap-2">
              {PAIN_AREAS.map((area) => {
                const isSelected = selectedPainAreas.has(area);
                return (
                  <button
                    key={area}
                    type="button"
                    onClick={() => togglePainArea(area)}
                    className={`rounded border px-3 py-1.5 text-xs font-medium transition-colors duration-150 ${chipClasses(isSelected)}`}
                    aria-pressed={isSelected}
                  >
                    {area}
                  </button>
                );
              })}
            </div>

            {selectedPainAreas.size > 0 && (
              <div className="mt-3 space-y-2">
                {Array.from(selectedPainAreas.entries()).map(
                  ([area, severity]) => (
                    <div
                      key={area}
                      className="flex items-center justify-between rounded border border-rule bg-paper px-3 py-2"
                    >
                      <span className="text-xs text-ink-soft">{area}</span>
                      <div className="flex gap-1">
                        {(["mild", "moderate", "severe"] as const).map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => setPainSeverity(area, s)}
                            className={`rounded px-2 py-0.5 text-[10px] font-medium capitalize transition-colors duration-150 ${
                              severity === s
                                ? "bg-amber-soft text-amber-pencil"
                                : "text-ink-faint hover:text-ink-soft"
                            }`}
                            aria-pressed={severity === s}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  ),
                )}
              </div>
            )}
          </div>

          <div>
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-faint">
              External factors
            </p>
            <div className="flex flex-wrap gap-2">
              {STRESSORS.map((stressor) => {
                const isSelected = selectedStressors.has(stressor);
                return (
                  <button
                    key={stressor}
                    type="button"
                    onClick={() => toggleStressor(stressor)}
                    className={`rounded border px-3 py-1.5 text-xs font-medium transition-colors duration-150 ${chipClasses(isSelected)}`}
                    aria-pressed={isSelected}
                  >
                    {stressor}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-ink-faint">
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything else your coach should know?"
              maxLength={1000}
              rows={3}
              className="w-full resize-none rounded border border-rule bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint"
            />
          </div>
        </div>

        <div className="sticky bottom-0 flex items-center justify-between border-t border-rule bg-paper-raised px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="text-xs text-ink-soft transition-colors hover:text-ink disabled:opacity-50"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isLoading}
            className="rounded bg-pencil-red px-5 py-2 text-sm font-semibold text-paper-raised transition-colors duration-150 hover:bg-pencil-red-deep disabled:opacity-50"
          >
            {isLoading ? "Saving…" : "Save note"}
          </button>
        </div>
      </div>
    </div>
  );
}
