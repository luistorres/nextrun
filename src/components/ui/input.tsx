"use client";

import { forwardRef, type InputHTMLAttributes } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, helperText, id, className = "", ...props },
  ref,
) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, "-");

  return (
    <div className="space-y-1">
      {label && (
        <label htmlFor={inputId} className="block text-sm font-medium text-ink">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        className={`block w-full rounded border bg-paper-raised px-3 py-2 text-sm text-ink transition-colors placeholder:text-ink-faint focus:outline-none ${
          error
            ? "border-pencil-red focus:border-pencil-red-deep"
            : "border-rule-strong focus:border-pencil-red"
        } ${className}`}
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
        <p id={`${inputId}-helper`} className="text-sm text-ink-faint">
          {helperText}
        </p>
      )}
    </div>
  );
});
