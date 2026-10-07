"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useRequestAdaptation } from "@/lib/query/plan-hooks";

interface RequestAdaptationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RequestAdaptationModal({
  open,
  onOpenChange,
}: RequestAdaptationModalProps) {
  const [context, setContext] = useState("");
  const mutation = useRequestAdaptation();

  if (!open) return null;

  const handleSubmit = async () => {
    try {
      await mutation.mutateAsync({
        context: context.trim() || undefined,
      });
      setContext("");
      onOpenChange(false);
    } catch {
      // Error state handled by mutation.isError in the render
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onOpenChange(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onKeyDown={handleKeyDown}
    >
      <div
        className="absolute inset-0 bg-ink/40"
        onClick={() => !mutation.isPending && onOpenChange(false)}
      />

      <div
        className="relative w-full max-w-md rounded-md border border-rule bg-paper-raised p-6 shadow-[0_1px_4px_rgba(38,36,31,0.06)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="request-adaptation-title"
      >
        <h2
          id="request-adaptation-title"
          className="text-lg font-semibold text-ink"
        >
          Request a plan review
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          Tell your coach what is on your mind. Your message goes into the
          review.
        </p>

        <textarea
          className="mt-4 w-full resize-none rounded border border-rule bg-paper px-3 py-2.5 text-sm text-ink placeholder:text-ink-faint"
          rows={4}
          maxLength={500}
          placeholder={`"I want a shorter taper", "my knee hurts after long runs", "I'm feeling strong, push me harder"`}
          value={context}
          onChange={(e) => setContext(e.target.value)}
          disabled={mutation.isPending}
          autoFocus
        />

        <p
          className={`mt-1.5 text-xs tabular-nums ${
            context.length > 450 ? "text-amber-pencil" : "text-ink-faint"
          }`}
        >
          {context.length}/500
        </p>

        {mutation.isError && (
          <div className="mt-3 rounded bg-red-soft px-3 py-2 text-sm text-pencil-red-deep">
            {mutation.error.message.includes("429")
              ? "You can request a plan review once every 6 hours. Try again later."
              : mutation.error.message.includes("409")
                ? "Your coach is already reviewing the plan. The new proposal will appear here shortly."
                : "The request did not go through. Try again."}
          </div>
        )}

        {mutation.isPending && (
          <p className="mt-3 text-sm text-ink-soft">
            Your coach is reviewing the plan…
          </p>
        )}

        <div className="mt-5 flex justify-end gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            disabled={mutation.isPending}
            loading={mutation.isPending}
          >
            {mutation.isPending ? "Reviewing…" : "Request review"}
          </Button>
        </div>
      </div>
    </div>
  );
}
