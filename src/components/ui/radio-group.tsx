"use client";

export interface RadioOption {
  value: string;
  label: string;
  description?: string;
}

interface RadioGroupProps {
  name: string;
  label?: string;
  options: RadioOption[];
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

export function RadioGroup({
  name,
  label,
  options,
  value,
  onChange,
  error,
}: RadioGroupProps) {
  return (
    <fieldset className="space-y-2">
      {label && (
        <legend className="block text-sm font-medium text-ink">{label}</legend>
      )}
      <div className="space-y-2">
        {options.map((option) => {
          const isSelected = value === option.value;
          return (
            <label
              key={option.value}
              className={`flex cursor-pointer items-start gap-3 rounded border p-4 transition-colors ${
                isSelected
                  ? "border-pencil-red bg-red-soft"
                  : "border-rule bg-paper-raised hover:border-rule-strong"
              }`}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={isSelected}
                onChange={() => onChange(option.value)}
                className="mt-0.5 h-4 w-4 accent-[var(--pencil-red)]"
              />
              <div className="flex-1">
                <span className="block text-sm font-medium text-ink">
                  {option.label}
                </span>
                {option.description && (
                  <span className="mt-0.5 block text-sm text-ink-soft">
                    {option.description}
                  </span>
                )}
              </div>
            </label>
          );
        })}
      </div>
      {error && <p className="text-sm text-pencil-red-deep">{error}</p>}
    </fieldset>
  );
}
