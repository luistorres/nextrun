"use client";

import {
  usePreferences,
  useUpdatePreferences,
  type UserPreferences,
} from "@/lib/query/settings-hooks";
import { Card, CardHeader, CardContent } from "@/components/ui/card";

export function PreferencesSection() {
  const { data, isLoading, error } = usePreferences();
  const updatePreferences = useUpdatePreferences();

  const prefs = data?.preferences;

  const handleChange = (field: keyof UserPreferences, value: string | boolean) => {
    updatePreferences.mutate({ [field]: value });
  };

  if (isLoading) {
    return <div className="skeleton h-56 rounded-md" />;
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="text-base font-semibold text-ink">
          Training preferences
        </h2>
        <p className="mt-0.5 text-sm text-ink-soft">
          Units, pace display, and notifications
        </p>
      </CardHeader>

      <CardContent>
        {error && (
          <div className="rounded-md bg-red-soft px-3 py-2">
            <p className="text-sm text-pencil-red-deep">
              Failed to load preferences. Reload the page to try again.
            </p>
          </div>
        )}

        {prefs && (
          <div className="divide-y divide-rule">
            <SegmentedRow
              label="Units"
              description="Distance and weight measurements"
              options={[
                { value: "metric", label: "Metric (km, kg)" },
                { value: "imperial", label: "Imperial (mi, lb)" },
              ]}
              value={prefs.units}
              onChange={(v) => handleChange("units", v)}
            />

            <SegmentedRow
              label="Pace display"
              description="How pace values are shown"
              options={[
                { value: "min_km", label: "min/km" },
                { value: "min_mi", label: "min/mi" },
              ]}
              value={prefs.paceDisplay}
              onChange={(v) => handleChange("paceDisplay", v)}
            />

            <SegmentedRow
              label="Week start day"
              description="First day of the training week"
              options={[
                { value: "monday", label: "Monday" },
                { value: "sunday", label: "Sunday" },
              ]}
              value={prefs.weekStartDay}
              onChange={(v) => handleChange("weekStartDay", v)}
            />

            <div className="flex items-center justify-between gap-4 py-4 last:pb-0">
              <div>
                <p className="text-sm font-medium text-ink">
                  Email notifications
                </p>
                <p className="text-sm text-ink-soft">
                  Weekly plan updates and adaptation alerts
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={prefs.emailNotifications}
                onClick={() =>
                  handleChange("emailNotifications", !prefs.emailNotifications)
                }
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border transition-colors duration-150 ${
                  prefs.emailNotifications
                    ? "border-sage bg-sage"
                    : "border-rule-strong bg-paper-shade"
                }`}
              >
                <span
                  className="pointer-events-none inline-block h-5 w-5 rounded-full bg-paper-raised shadow-sm transition-transform duration-150"
                  style={{
                    transform: prefs.emailNotifications
                      ? "translateX(20px)"
                      : "translateX(0)",
                  }}
                />
              </button>
            </div>

            {updatePreferences.isError && (
              <p className="pt-3 text-sm text-pencil-red-deep">
                Failed to save. Try again.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SegmentedRow({
  label,
  description,
  options,
  value,
  onChange,
}: {
  label: string;
  description: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <p className="text-sm font-medium text-ink">{label}</p>
      <p className="mb-2 text-sm text-ink-soft">{description}</p>
      <div className="flex gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`rounded border px-3 py-1.5 text-sm transition-colors duration-150 ${
              value === option.value
                ? "border-rule-strong bg-paper-shade font-medium text-ink"
                : "border-rule text-ink-soft hover:bg-paper-shade"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
