"use client";

const OPTIONS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "All", days: 0 },
] as const;

interface DateRangeSelectorProps {
  value: number;
  onChange: (days: number) => void;
}

export function DateRangeSelector({ value, onChange }: DateRangeSelectorProps) {
  return (
    <div
      className="inline-flex rounded-md border border-rule bg-paper-raised p-0.5"
      role="radiogroup"
      aria-label="Chart date range"
    >
      {OPTIONS.map((opt) => {
        const isSelected = value === opt.days;
        return (
          <button
            key={opt.days}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onChange(opt.days)}
            className={`rounded px-3 py-1 text-xs transition-colors ${
              isSelected
                ? "bg-paper-shade font-medium text-ink"
                : "text-ink-soft hover:text-ink"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
