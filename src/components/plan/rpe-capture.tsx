"use client";

import { useState, useRef, useCallback, useEffect, useId } from "react";

type PerceivedDifficulty =
  | "much_easier_than_expected"
  | "easier_than_expected"
  | "as_expected"
  | "harder_than_expected"
  | "much_harder_than_expected";

interface RPECaptureProps {
  onSave: (
    rpeScore: number | undefined,
    perceivedDifficulty: PerceivedDifficulty | undefined,
  ) => void;
  onSkip: () => void;
  isLoading?: boolean;
}

const ZONES: { min: number; max: number; label: string }[] = [
  { min: 1, max: 3, label: "Easy" },
  { min: 4, max: 6, label: "Moderate" },
  { min: 7, max: 8, label: "Hard" },
  { min: 9, max: 10, label: "Max" },
];

const RPE_HINTS: Record<number, string> = {
  1: "Very light — easy walk",
  2: "Light — gentle effort",
  3: "Easy — full conversation",
  4: "Somewhat easy — sustainable",
  5: "Moderate — noticeably working",
  6: "Moderate-hard — breathing harder",
  7: "Hard — few words at a time",
  8: "Very hard — near your limit",
  9: "Near-max — can't speak",
  10: "Absolute max — all-out",
};

function getZoneForRpe(rpe: number): (typeof ZONES)[0] {
  return ZONES.find((z) => rpe >= z.min && rpe <= z.max) ?? ZONES[0];
}

const DIFFICULTY_OPTIONS: {
  value: PerceivedDifficulty;
  label: string;
  hint: string;
}[] = [
  {
    value: "much_easier_than_expected",
    label: "Much easier",
    hint: "Effort felt surprisingly light. Could mean improved fitness or an over-estimated target.",
  },
  {
    value: "easier_than_expected",
    label: "Easier",
    hint: "A bit lighter than planned — good recovery or conservative pacing.",
  },
  {
    value: "as_expected",
    label: "As expected",
    hint: "The session matched the plan. Pacing and effort were on the mark.",
  },
  {
    value: "harder_than_expected",
    label: "Harder",
    hint: "More taxing than planned. Could be fatigue, heat, or external stress — your coach will account for it.",
  },
  {
    value: "much_harder_than_expected",
    label: "Much harder",
    hint: "Significantly tougher than expected. Worth flagging so upcoming sessions can be adjusted.",
  },
];

function InfoTooltip({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const tooltipId = useId();

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div
      ref={ref}
      className="relative inline-flex items-center"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className={`ml-1.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border text-[10px] font-bold transition-colors ${
          open
            ? "border-pencil-red text-pencil-red"
            : "border-rule-strong text-ink-faint"
        }`}
        aria-label="More info"
        aria-describedby={open ? tooltipId : undefined}
      >
        ?
      </button>
      {open && (
        <div
          id={tooltipId}
          role="tooltip"
          className="absolute bottom-full left-1/2 z-50 mb-2 w-56 -translate-x-1/2 rounded-md border border-rule bg-paper-raised px-3 py-2.5 text-[11px] leading-relaxed text-ink-soft shadow-[0_1px_4px_rgba(38,36,31,0.06)]"
        >
          {content}
        </div>
      )}
    </div>
  );
}

function RPESlider({
  value,
  onChange,
}: {
  value: number | undefined;
  onChange: (v: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const valueToPercent = (v: number) => ((v - 1) / 9) * 100;
  const posToValue = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track) return 1;
    const { left, width } = track.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - left) / width));
    return Math.round(pct * 9) + 1;
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      isDragging.current = true;
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      onChange(posToValue(e.clientX));
    },
    [onChange, posToValue],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging.current) return;
      onChange(posToValue(e.clientX));
    },
    [onChange, posToValue],
  );

  const handlePointerUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const zone = value != null ? getZoneForRpe(value) : null;
  const percent = value != null ? valueToPercent(value) : null;

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
      <div className="flex items-center gap-3 sm:flex-col sm:items-center sm:gap-1">
        <div
          className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-md border font-mono text-2xl font-bold tabular-nums transition-colors duration-150 ${
            value != null
              ? "border-rule-strong bg-paper-shade text-ink"
              : "border-rule bg-paper text-ink-faint"
          }`}
        >
          {value ?? "—"}
        </div>
        <div className="sm:hidden">
          {zone && value != null ? (
            <>
              <p className="text-sm font-semibold text-ink">{zone.label}</p>
              <p className="text-xs text-ink-soft">{RPE_HINTS[value]}</p>
            </>
          ) : (
            <p className="text-sm text-ink-soft">Slide to rate</p>
          )}
        </div>
      </div>

      <div className="flex-1" style={{ touchAction: "none" }}>
        <div
          ref={trackRef}
          className="relative h-2 cursor-pointer select-none rounded-full bg-paper-shade"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          role="slider"
          aria-valuemin={1}
          aria-valuemax={10}
          aria-valuenow={value}
          aria-label="RPE effort level"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowUp")
              onChange(Math.min(10, (value ?? 0) + 1));
            if (e.key === "ArrowLeft" || e.key === "ArrowDown")
              onChange(Math.max(1, (value ?? 11) - 1));
          }}
        >
          {percent != null && (
            <div
              className="absolute left-0 top-0 h-full rounded-full bg-ink-soft"
              style={{ width: `${percent}%` }}
            />
          )}
          {percent != null && (
            <div
              className="pointer-events-none absolute top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border border-rule-strong bg-paper-raised shadow-[0_1px_4px_rgba(38,36,31,0.15)] transition-[left] duration-75 sm:h-5 sm:w-5"
              style={{ left: `${percent}%` }}
            />
          )}
          <div className="absolute -inset-y-3 inset-x-0" />
        </div>

        <div className="mt-2 flex justify-between text-[11px] text-ink-faint">
          <span>Easy</span>
          <span>Moderate</span>
          <span>Hard</span>
          <span>Max</span>
        </div>

        <div className="mt-1 hidden h-4 sm:block">
          {zone && value != null && (
            <p className="text-[11px] text-ink-soft">{RPE_HINTS[value]}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function SegmentedSelector<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; hint: string }[];
  value: T | undefined;
  onChange: (v: T | undefined) => void;
}) {
  const [hinted, setHinted] = useState<T | null>(null);
  const activeHint = hinted
    ? options.find((o) => o.value === hinted)?.hint
    : value
      ? options.find((o) => o.value === value)?.hint
      : null;

  return (
    <div className="space-y-2">
      <div className="sm:max-w-sm">
        <div
          className="flex rounded-md border border-rule bg-paper-shade p-0.5"
          role="radiogroup"
        >
          {options.map((opt) => {
            const isSelected = value === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => onChange(isSelected ? undefined : opt.value)}
                onMouseEnter={() => setHinted(opt.value)}
                onMouseLeave={() => setHinted(null)}
                className={`flex-1 rounded px-1 py-2 text-xs font-medium transition-colors duration-150 ${
                  isSelected
                    ? "border border-rule-strong bg-paper-raised text-ink shadow-[0_1px_4px_rgba(38,36,31,0.06)]"
                    : "text-ink-soft hover:text-ink"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="min-h-[1.25rem]">
        {activeHint && (
          <p className="text-[11px] leading-snug text-ink-soft">{activeHint}</p>
        )}
      </div>
    </div>
  );
}

export function RPECapture({ onSave, onSkip, isLoading }: RPECaptureProps) {
  const [rpe, setRpe] = useState<number | undefined>(undefined);
  const [difficulty, setDifficulty] = useState<PerceivedDifficulty | undefined>(
    undefined,
  );

  return (
    <div className="mt-4 space-y-6 rounded-md border border-rule bg-paper p-5">
      <div>
        <p className="text-sm font-semibold text-ink">
          How did this session feel?
        </p>
        <p className="mt-0.5 text-xs text-ink-soft">
          A quick check-in helps your coach tune what comes next.
        </p>
      </div>

      <div>
        <div className="mb-3 flex items-center">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">
            Effort level
          </p>
          <InfoTooltip content="Rate of Perceived Exertion (RPE) — how hard the session felt overall, on a scale of 1 to 10. Slide or use arrow keys." />
        </div>
        <RPESlider value={rpe} onChange={setRpe} />
      </div>

      <div className="border-t border-rule" />

      <div>
        <div className="mb-3 flex items-center">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">
            Compared to plan
          </p>
          <InfoTooltip content="How this felt relative to what was scheduled — not just effort in isolation. An easy run that felt hard may signal fatigue. A tempo that felt easy may mean you're ready to progress." />
        </div>
        <SegmentedSelector
          options={DIFFICULTY_OPTIONS}
          value={difficulty}
          onChange={(v) => setDifficulty(v as PerceivedDifficulty | undefined)}
        />
      </div>

      <div className="flex items-center justify-between pt-1">
        <button
          type="button"
          onClick={onSkip}
          disabled={isLoading}
          className="text-xs text-ink-soft transition-colors duration-150 hover:text-ink disabled:opacity-50"
        >
          Skip and complete
        </button>
        <button
          type="button"
          onClick={() => onSave(rpe, difficulty)}
          disabled={isLoading}
          className="rounded bg-pencil-red px-4 py-2 text-sm font-semibold text-paper-raised transition-colors duration-150 hover:bg-pencil-red-deep disabled:opacity-50"
        >
          {isLoading ? "Saving…" : "Save and complete"}
        </button>
      </div>

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {isLoading ? "Saving your feedback" : ""}
      </div>
    </div>
  );
}
