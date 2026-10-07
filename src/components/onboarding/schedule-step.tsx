"use client";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import type { ScheduleFormData } from "@/hooks/use-onboarding";

const DAYS = [
  { value: "monday", label: "Monday", short: "Mon" },
  { value: "tuesday", label: "Tuesday", short: "Tue" },
  { value: "wednesday", label: "Wednesday", short: "Wed" },
  { value: "thursday", label: "Thursday", short: "Thu" },
  { value: "friday", label: "Friday", short: "Fri" },
  { value: "saturday", label: "Saturday", short: "Sat" },
  { value: "sunday", label: "Sunday", short: "Sun" },
];

const LONG_RUN_OPTIONS = DAYS.map((d) => ({
  value: d.value,
  label: d.label,
}));

interface ScheduleStepProps {
  data: ScheduleFormData;
  onChange: (updates: Partial<ScheduleFormData>) => void;
  onNext: () => void;
  onBack: () => void;
  error: string | null;
  hasProfile?: boolean;
}

export function ScheduleStep({
  data,
  onChange,
  onNext,
  onBack,
  error,
  hasProfile,
}: ScheduleStepProps) {
  const toggleDay = (day: string) => {
    const current = data.preferredTrainingDays;
    const updated = current.includes(day)
      ? current.filter((d) => d !== day)
      : [...current, day];
    onChange({
      preferredTrainingDays: updated,
      trainingDaysPerWeek: updated.length,
    });
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-ink">Which days can you run?</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          Pick at least 3 days. The plan fits around them.
        </p>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <label className="block text-sm font-medium text-ink">
            Training days ({data.preferredTrainingDays.length} selected)
          </label>
          {hasProfile && (
            <span className="text-[11px] text-ink-faint">
              Suggested from your training history
            </span>
          )}
        </div>
        <div className="grid grid-cols-7 gap-2">
          {DAYS.map((day) => {
            const isSelected = data.preferredTrainingDays.includes(day.value);
            return (
              <button
                key={day.value}
                type="button"
                onClick={() => toggleDay(day.value)}
                aria-pressed={isSelected}
                className={`flex flex-col items-center rounded-md border p-3 text-sm font-medium transition-colors ${
                  isSelected
                    ? "border-sage bg-sage-soft text-sage"
                    : "border-rule bg-paper-raised text-ink-soft hover:border-rule-strong hover:text-ink"
                }`}
              >
                <span className="hidden sm:block">{day.short}</span>
                <span className="sm:hidden">{day.short.charAt(0)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <Select
        label="Long run day"
        options={LONG_RUN_OPTIONS}
        value={data.preferredLongRunDay}
        onChange={(e) => onChange({ preferredLongRunDay: e.target.value })}
      />

      {data.preferredTrainingDays.length >= 3 && (
        <p className="border-l border-rule-strong pl-4 text-sm leading-relaxed text-ink-soft">
          {data.preferredTrainingDays.length} days per week — easy runs, quality
          sessions, and a long run on{" "}
          {DAYS.find((d) => d.value === data.preferredLongRunDay)?.label ??
            data.preferredLongRunDay}
          .
        </p>
      )}

      {error && (
        <div className="rounded-md bg-red-soft p-3">
          <p className="text-sm text-pencil-red-deep">{error}</p>
        </div>
      )}

      <div className="flex justify-between border-t border-rule pt-6">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button variant="primary" onClick={onNext}>
          Continue
        </Button>
      </div>
    </div>
  );
}
