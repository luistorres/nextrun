"use client";

import { forwardRef, type InputHTMLAttributes } from "react";

export interface DatePickerProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const DatePicker = forwardRef<HTMLInputElement, DatePickerProps>(
  function DatePicker(
    { label, error, helperText, id, className = "", style, ...props },
    ref,
  ) {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, "-");

    return (
      <div className="space-y-1">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-ink"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          type="date"
          id={inputId}
          className={`block w-full rounded-md border bg-paper-raised px-3 py-2 text-sm text-ink transition-colors placeholder:text-ink-faint ${
            error ? "border-pencil-red" : "border-rule"
          } ${className}`}
          style={{ colorScheme: "light", ...style }}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={
            error
              ? `${inputId}-error`
              : helperText
                ? `${inputId}-helper`
                : undefined
          }
          {...props}
        />
        {error && (
          <p id={`${inputId}-error`} className="text-sm text-pencil-red-deep">
            {error}
          </p>
        )}
        {!error && helperText && (
          <p id={`${inputId}-helper`} className="text-sm text-ink-soft">
            {helperText}
          </p>
        )}
      </div>
    );
  },
);
