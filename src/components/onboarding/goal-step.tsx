"use client";

import { RadioGroup } from "@/components/ui/radio-group";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { Button } from "@/components/ui/button";
import type { GoalFormData } from "@/hooks/use-onboarding";
import type { GoalType } from "@/types/plan";

const DISTANCE_OPTIONS = [
  { value: "5000", label: "5K" },
  { value: "10000", label: "10K" },
  { value: "21097", label: "Half marathon (21.1 km)" },
  { value: "42195", label: "Marathon (42.2 km)" },
  { value: "0", label: "Custom distance" },
];

const GOAL_TYPE_OPTIONS = [
  {
    value: "race" as GoalType,
    label: "Race",
    description: "Train for a specific race with a date and distance",
  },
  {
    value: "general_fitness" as GoalType,
    label: "General fitness",
    description: "Improve running fitness without a race on the calendar",
  },
  {
    value: "distance_milestone" as GoalType,
    label: "Distance milestone",
    description: "Build up to running a target distance comfortably",
  },
];

function secondsToHMS(totalSeconds: number | null): {
  hours: string;
  minutes: string;
  seconds: string;
} {
  if (totalSeconds == null || totalSeconds <= 0) {
    return { hours: "", minutes: "", seconds: "" };
  }
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return {
    hours: h > 0 ? String(h) : "",
    minutes: m > 0 || h > 0 ? String(m) : "",
    seconds: s > 0 ? String(s) : "",
  };
}

function hmsToSeconds(
  hours: string,
  minutes: string,
  seconds: string,
): number | null {
  const h = parseInt(hours, 10) || 0;
  const m = parseInt(minutes, 10) || 0;
  const s = parseInt(seconds, 10) || 0;
  const total = h * 3600 + m * 60 + s;
  return total > 0 ? total : null;
}

function formatTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

interface GoalStepProps {
  data: GoalFormData;
  onChange: (updates: Partial<GoalFormData>) => void;
  onNext: () => void;
  onBack: () => void;
  error: string | null;
  suggestedTargetTime?: number | null;
}

export function GoalStep({
  data,
  onChange,
  onNext,
  onBack,
  error,
  suggestedTargetTime,
}: GoalStepProps) {
  const isCustomDistance = !DISTANCE_OPTIONS.some(
    (d) => d.value === String(data.targetDistanceMeters) && d.value !== "0",
  );

  const timeHMS = secondsToHMS(data.targetTimeSeconds);

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = tomorrow.toISOString().split("T")[0];

  const showSuggestion =
    suggestedTargetTime != null &&
    suggestedTargetTime > 0 &&
    data.targetDistanceMeters > 0;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-ink">What are you training for?</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          The goal sets the shape of the whole plan.
        </p>
      </div>

      <RadioGroup
        name="goalType"
        label="Goal type"
        options={GOAL_TYPE_OPTIONS}
        value={data.goalType}
        onChange={(val) => onChange({ goalType: val as GoalType })}
      />

      {data.goalType === "race" && (
        <div className="space-y-4 border-l border-rule-strong pl-4">
          <Input
            label="Race name (optional)"
            placeholder="e.g. Porto Marathon 2026"
            value={data.raceName}
            onChange={(e) => onChange({ raceName: e.target.value })}
          />
          <DatePicker
            label="Race date"
            value={data.raceDate}
            min={minDate}
            onChange={(e) => onChange({ raceDate: e.target.value })}
          />
        </div>
      )}

      <Select
        label="Target distance"
        options={DISTANCE_OPTIONS}
        value={isCustomDistance ? "0" : String(data.targetDistanceMeters)}
        onChange={(e) => {
          const val = parseInt(e.target.value, 10);
          if (val === 0) {
            onChange({ targetDistanceMeters: 0 });
          } else {
            onChange({ targetDistanceMeters: val });
          }
        }}
      />

      {(isCustomDistance || data.targetDistanceMeters === 0) && (
        <Input
          label="Custom distance (km)"
          type="number"
          min={1}
          step={0.1}
          placeholder="e.g. 15"
          value={
            data.targetDistanceMeters > 0
              ? String(data.targetDistanceMeters / 1000)
              : ""
          }
          onChange={(e) => {
            const km = parseFloat(e.target.value) || 0;
            onChange({ targetDistanceMeters: Math.round(km * 1000) });
          }}
        />
      )}

      <div className="space-y-1">
        <label className="block text-sm font-medium text-ink">
          Target finish time (optional)
        </label>
        <div className="flex items-center gap-2">
          <Input
            placeholder="H"
            type="number"
            min={0}
            max={12}
            value={timeHMS.hours}
            onChange={(e) =>
              onChange({
                targetTimeSeconds: hmsToSeconds(
                  e.target.value,
                  timeHMS.minutes,
                  timeHMS.seconds,
                ),
              })
            }
            className="w-20 text-center"
          />
          <span className="text-ink-faint">:</span>
          <Input
            placeholder="MM"
            type="number"
            min={0}
            max={59}
            value={timeHMS.minutes}
            onChange={(e) =>
              onChange({
                targetTimeSeconds: hmsToSeconds(
                  timeHMS.hours,
                  e.target.value,
                  timeHMS.seconds,
                ),
              })
            }
            className="w-20 text-center"
          />
          <span className="text-ink-faint">:</span>
          <Input
            placeholder="SS"
            type="number"
            min={0}
            max={59}
            value={timeHMS.seconds}
            onChange={(e) =>
              onChange({
                targetTimeSeconds: hmsToSeconds(
                  timeHMS.hours,
                  timeHMS.minutes,
                  e.target.value,
                ),
              })
            }
            className="w-20 text-center"
          />
        </div>
        <p className="text-sm text-ink-faint">
          Leave blank to train for a comfortable finish.
        </p>
      </div>

      {showSuggestion && (
        <div className="flex items-center justify-between gap-3 rounded-md bg-sage-soft px-4 py-3">
          <span className="text-sm text-sage">
            Based on your fitness: ~{formatTime(suggestedTargetTime!)}
          </span>
          <button
            type="button"
            onClick={() => onChange({ targetTimeSeconds: suggestedTargetTime! })}
            className="shrink-0 rounded border border-rule-strong bg-paper-raised px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:bg-paper-shade hover:text-ink"
          >
            Use suggestion
          </button>
        </div>
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
