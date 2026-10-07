"use client";

import { useState } from "react";
import { RadioGroup } from "@/components/ui/radio-group";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { ExperienceFormData } from "@/hooks/use-onboarding";
import type { HealthConstraint } from "@/types/health";

const EXPERIENCE_OPTIONS = [
  {
    value: "beginner",
    label: "Beginner",
    description: "Running for less than a year, or less than 15 km per week",
  },
  {
    value: "intermediate",
    label: "Intermediate",
    description: "Running consistently for 1–3 years, 20–50 km per week",
  },
  {
    value: "advanced",
    label: "Advanced",
    description: "Running 3+ years with structured training, 50+ km per week",
  },
];

const WORKOUT_TYPES = [
  { value: "easy_run", label: "Easy run" },
  { value: "long_run", label: "Long run" },
  { value: "tempo", label: "Tempo" },
  { value: "intervals", label: "Intervals" },
  { value: "hill_repeats", label: "Hill repeats" },
  { value: "race_pace", label: "Race pace" },
  { value: "fartlek", label: "Fartlek" },
  { value: "recovery", label: "Recovery" },
  { value: "cross_training", label: "Cross training" },
  { value: "rest", label: "Rest" },
];

const CATEGORIES = [
  { value: "injury", label: "Injury" },
  { value: "chronic_condition", label: "Chronic condition" },
  { value: "equipment", label: "Equipment" },
  { value: "lifestyle", label: "Lifestyle" },
] as const;

const SEVERITY_OPTIONS = [
  {
    value: "avoid" as const,
    label: "Avoid",
    description: "Don't schedule these workout types",
  },
  {
    value: "modify" as const,
    label: "Modify",
    description: "Reduce intensity for these types",
  },
  {
    value: "monitor" as const,
    label: "Monitor",
    description: "Keep an eye on it, no automatic changes",
  },
];

const SEVERITY_CHIP: Record<HealthConstraint["severity"], string> = {
  avoid: "bg-red-soft text-pencil-red-deep",
  modify: "bg-amber-soft text-amber-pencil",
  monitor: "bg-paper-shade text-ink-soft",
};

interface ConstraintFormState {
  label: string;
  category: HealthConstraint["category"];
  severity: HealthConstraint["severity"];
  affectedWorkoutTypes: string[];
  notes: string;
}

const BLANK_FORM: ConstraintFormState = {
  label: "",
  category: "injury",
  severity: "modify",
  affectedWorkoutTypes: [],
  notes: "",
};

const FIELD_CLASSES =
  "block w-full rounded border border-rule-strong bg-paper-raised px-3 py-2 text-sm text-ink transition-colors placeholder:text-ink-faint focus:border-pencil-red focus:outline-none";

function HealthConstraintsInput({
  constraints,
  onChange,
}: {
  constraints: HealthConstraint[];
  onChange: (constraints: HealthConstraint[]) => void;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [form, setForm] = useState<ConstraintFormState>(BLANK_FORM);

  function updateForm(updates: Partial<ConstraintFormState>) {
    setForm((prev) => ({ ...prev, ...updates }));
  }

  function toggleWorkoutType(type: string) {
    updateForm({
      affectedWorkoutTypes: form.affectedWorkoutTypes.includes(type)
        ? form.affectedWorkoutTypes.filter((t) => t !== type)
        : [...form.affectedWorkoutTypes, type],
    });
  }

  function handleAdd() {
    if (!form.label.trim()) return;
    const newConstraint: HealthConstraint = {
      id: crypto.randomUUID(),
      label: form.label.trim(),
      category: form.category,
      severity: form.severity,
      affectedWorkoutTypes: form.affectedWorkoutTypes,
      notes: form.notes.trim() || undefined,
    };
    onChange([...constraints, newConstraint]);
    setForm(BLANK_FORM);
    setIsAdding(false);
  }

  function handleRemove(id: string) {
    onChange(constraints.filter((c) => c.id !== id));
  }

  function handleCancel() {
    setForm(BLANK_FORM);
    setIsAdding(false);
  }

  return (
    <div className="space-y-3">
      {constraints.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {constraints.map((c) => (
            <span
              key={c.id}
              className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium ${SEVERITY_CHIP[c.severity]}`}
            >
              <span className="text-[10px] uppercase opacity-70">
                {c.severity}
              </span>
              <span>{c.label}</span>
              <button
                type="button"
                onClick={() => handleRemove(c.id)}
                className="ml-0.5 opacity-60 transition-opacity hover:opacity-100"
                aria-label={`Remove ${c.label}`}
              >
                <svg
                  className="h-3 w-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}

      {isAdding ? (
        <div className="space-y-4 rounded-md border border-rule bg-paper-shade p-4">
          <div className="space-y-1">
            <label className="block text-xs font-medium text-ink">
              What is it? <span className="text-pencil-red">*</span>
            </label>
            <input
              type="text"
              className={FIELD_CLASSES}
              placeholder="e.g. Left knee patellofemoral pain"
              value={form.label}
              onChange={(e) => updateForm({ label: e.target.value })}
              autoFocus
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-ink">
              Category
            </label>
            <select
              className={FIELD_CLASSES}
              value={form.category}
              onChange={(e) =>
                updateForm({
                  category: e.target.value as HealthConstraint["category"],
                })
              }
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-ink">
              How it affects training
            </label>
            <div className="grid grid-cols-3 gap-2">
              {SEVERITY_OPTIONS.map((opt) => {
                const isSelected = form.severity === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => updateForm({ severity: opt.value })}
                    aria-pressed={isSelected}
                    className={`rounded-md border p-2.5 text-left transition-colors ${
                      isSelected
                        ? "border-rule-strong bg-paper-raised text-ink"
                        : "border-rule bg-paper-raised text-ink-faint hover:border-rule-strong hover:text-ink-soft"
                    }`}
                  >
                    <span className="block text-xs font-semibold">
                      {opt.label}
                    </span>
                    <span className="mt-0.5 block text-[10px] leading-tight opacity-80">
                      {opt.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-ink">
              Affected workout types
              <span className="ml-1 font-normal text-ink-faint">
                (optional)
              </span>
            </label>
            <div className="flex flex-wrap gap-1.5">
              {WORKOUT_TYPES.map((wt) => {
                const isSelected = form.affectedWorkoutTypes.includes(wt.value);
                return (
                  <button
                    key={wt.value}
                    type="button"
                    onClick={() => toggleWorkoutType(wt.value)}
                    className={`rounded border px-2.5 py-1 text-xs font-medium transition-colors ${
                      isSelected
                        ? "border-sage bg-sage-soft text-sage"
                        : "border-rule bg-paper-raised text-ink-faint hover:border-rule-strong hover:text-ink-soft"
                    }`}
                    aria-pressed={isSelected}
                  >
                    {wt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-ink">
              Notes
              <span className="ml-1 font-normal text-ink-faint">
                (optional)
              </span>
            </label>
            <textarea
              rows={2}
              className={FIELD_CLASSES}
              placeholder="e.g. Avoid downhill running, pain above 3/10 means stop"
              value={form.notes}
              onChange={(e) => updateForm({ notes: e.target.value })}
            />
          </div>

          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={handleCancel}
              className="text-xs text-ink-soft transition-colors hover:text-ink"
            >
              Cancel
            </button>
            <Button size="sm" onClick={handleAdd} disabled={!form.label.trim()}>
              Add constraint
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setIsAdding(true)}
          className="flex items-center gap-1.5 rounded-md border border-dashed border-rule-strong px-3 py-2 text-xs font-medium text-ink-soft transition-colors hover:bg-paper-shade hover:text-ink"
        >
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 4.5v15m7.5-7.5h-15"
            />
          </svg>
          Add injury or constraint
        </button>
      )}
    </div>
  );
}

interface ExperienceStepProps {
  data: ExperienceFormData;
  onChange: (updates: Partial<ExperienceFormData>) => void;
  onNext: () => void;
  onBack: () => void;
  error: string | null;
  isSubmitting: boolean;
  hasProfile?: boolean;
}

export function ExperienceStep({
  data,
  onChange,
  onNext,
  onBack,
  error,
  isSubmitting,
  hasProfile,
}: ExperienceStepProps) {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-ink">Your background</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          Experience, mileage, and anything the plan should respect.
        </p>
      </div>

      <div>
        <RadioGroup
          name="experienceLevel"
          label="Running experience"
          options={EXPERIENCE_OPTIONS}
          value={data.experienceLevel}
          onChange={(val) =>
            onChange({
              experienceLevel: val as ExperienceFormData["experienceLevel"],
            })
          }
        />
        {hasProfile && (
          <p className="mt-2 text-[11px] text-ink-faint">
            Inferred from your training
          </p>
        )}
      </div>

      <Input
        label="Recent weekly mileage (km)"
        type="number"
        min={0}
        max={300}
        step={1}
        placeholder="e.g. 30"
        value={
          data.recentWeeklyMileageKm > 0
            ? String(data.recentWeeklyMileageKm)
            : ""
        }
        onChange={(e) =>
          onChange({ recentWeeklyMileageKm: parseInt(e.target.value, 10) || 0 })
        }
        helperText={
          hasProfile
            ? "Calculated from your Garmin data"
            : "Approximate average over the last 4 weeks"
        }
      />

      <div className="space-y-3">
        <div>
          <p className="block text-sm font-medium text-ink">
            Health and constraints
            <span className="ml-1.5 text-xs font-normal text-ink-faint">
              (optional)
            </span>
          </p>
          <p className="mt-0.5 text-xs text-ink-soft">
            Injuries, chronic conditions, or anything the plan should respect.
          </p>
        </div>
        <HealthConstraintsInput
          constraints={data.healthConstraints}
          onChange={(hc) => onChange({ healthConstraints: hc })}
        />
      </div>

      <div className="space-y-1">
        <label
          htmlFor="other-notes"
          className="block text-sm font-medium text-ink"
        >
          Other notes
          <span className="ml-1.5 text-xs font-normal text-ink-faint">
            (optional)
          </span>
        </label>
        <textarea
          id="other-notes"
          rows={2}
          className={FIELD_CLASSES}
          placeholder="e.g. Cross-training on Wednesdays, prefer morning runs"
          value={data.constraints}
          onChange={(e) => onChange({ constraints: e.target.value })}
        />
      </div>

      {error && (
        <div className="rounded-md bg-red-soft p-3">
          <p className="text-sm text-pencil-red-deep">{error}</p>
        </div>
      )}

      <div className="flex justify-between border-t border-rule pt-6">
        <Button variant="ghost" onClick={onBack} disabled={isSubmitting}>
          Back
        </Button>
        <Button variant="primary" onClick={onNext} loading={isSubmitting}>
          {isSubmitting ? "Building your plan" : "Generate plan"}
        </Button>
      </div>
    </div>
  );
}
