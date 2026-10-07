"use client";

import { useState, useCallback, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

type Sentiment =
  | "feeling_great"
  | "feeling_good"
  | "feeling_okay"
  | "feeling_tired"
  | "feeling_terrible";

interface CheckinResponse {
  feedback: unknown[];
  checkedInToday: boolean;
}

const SENTIMENTS: { value: Sentiment; label: string }[] = [
  { value: "feeling_great", label: "Great" },
  { value: "feeling_good", label: "Good" },
  { value: "feeling_okay", label: "Okay" },
  { value: "feeling_tired", label: "Tired" },
  { value: "feeling_terrible", label: "Terrible" },
];

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<T>;
}

async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<T>;
}

export function DailyCheckin() {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [sentiment, setSentiment] = useState<Sentiment | undefined>();
  const [notes, setNotes] = useState("");
  const sentimentRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const { data, isLoading: isChecking } = useQuery<CheckinResponse>({
    queryKey: ["feedback", "daily"],
    queryFn: () => fetchJSON<CheckinResponse>("/api/feedback"),
    staleTime: 5 * 60 * 1000,
  });

  const mutation = useMutation({
    mutationFn: (body: { sentiment?: Sentiment; contextualNotes?: string }) =>
      postJSON("/api/feedback", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["feedback", "daily"] });
      setExpanded(false);
      setSentiment(undefined);
      setNotes("");
    },
  });

  const handleSubmit = useCallback(() => {
    mutation.mutate({
      sentiment,
      contextualNotes: notes.trim() || undefined,
    });
  }, [sentiment, notes, mutation]);

  // Arrow-key navigation between sentiment radios (roving focus + selection)
  const handleSentimentKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      let next: number | null = null;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        next = (index + 1) % SENTIMENTS.length;
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        next = (index - 1 + SENTIMENTS.length) % SENTIMENTS.length;
      }
      if (next != null) {
        e.preventDefault();
        setSentiment(SENTIMENTS[next].value);
        sentimentRefs.current[next]?.focus();
      }
    },
    [],
  );

  const checkedInToday = data?.checkedInToday ?? false;

  if (isChecking) {
    return (
      <div className="rounded-md border border-rule bg-paper-raised p-5">
        <div className="skeleton h-4 w-40" />
        <div className="skeleton mt-2 h-3 w-56" />
      </div>
    );
  }

  return (
    <div className="rounded-md border border-rule bg-paper-raised">
      <button
        type="button"
        onClick={() => !checkedInToday && setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
        disabled={checkedInToday}
      >
        <div className="flex items-center gap-3">
          {checkedInToday && (
            <svg
              className="pencil-check h-4 w-4 shrink-0 text-sage"
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
          )}
          <div>
            <p className="text-sm font-semibold text-ink">
              {checkedInToday ? "Checked in" : "How did today feel?"}
            </p>
            <p className="text-xs text-ink-soft">
              {checkedInToday
                ? "Your coach has today's note."
                : "One line. It feeds into how the plan adapts."}
            </p>
          </div>
        </div>
        {!checkedInToday && (
          <svg
            className={`h-4 w-4 shrink-0 text-ink-faint transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m19.5 8.25-7.5 7.5-7.5-7.5"
            />
          </svg>
        )}
      </button>

      {expanded && !checkedInToday && (
        <div className="space-y-4 border-t border-rule px-5 pb-5 pt-4">
          <div
            role="radiogroup"
            aria-label="How did today feel?"
            className="flex gap-2"
          >
            {SENTIMENTS.map((s, i) => {
              const isSelected = sentiment === s.value;
              // Roving tabindex: selected radio is tabbable; first if none selected
              const isTabbable = sentiment ? isSelected : i === 0;
              return (
                <button
                  key={s.value}
                  ref={(el) => {
                    sentimentRefs.current[i] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  tabIndex={isTabbable ? 0 : -1}
                  onClick={() =>
                    setSentiment(isSelected ? undefined : s.value)
                  }
                  onKeyDown={(e) => handleSentimentKeyDown(e, i)}
                  className={`flex-1 whitespace-nowrap rounded border px-0.5 py-2 text-[11px] transition-colors duration-150 min-[400px]:text-xs ${
                    isSelected
                      ? "border-rule-strong bg-paper-shade font-semibold text-ink"
                      : "border-rule font-medium text-ink-soft hover:bg-paper-shade"
                  }`}
                >
                  {s.label}
                </button>
              );
            })}
          </div>

          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything worth noting (optional)"
            maxLength={500}
            rows={2}
            className="w-full resize-none rounded border border-rule bg-paper-raised px-3 py-2 text-sm text-ink placeholder:text-ink-faint"
          />

          {mutation.isError && (
            <p className="text-sm text-pencil-red-deep">
              Couldn&apos;t save the check-in. Try again.
            </p>
          )}

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="text-xs font-medium text-ink-soft transition-colors hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={mutation.isPending || !sentiment}
              className="rounded bg-pencil-red px-4 py-2 text-sm font-semibold text-paper-raised transition-colors duration-150 hover:bg-pencil-red-deep disabled:cursor-not-allowed disabled:opacity-50"
            >
              {mutation.isPending ? "Saving…" : "Check in"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
