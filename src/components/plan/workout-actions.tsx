"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

interface WorkoutActionsProps {
  completionStatus: string;
  onSkip: (reason?: string) => void;
  onReschedule: (newDate: string) => void;
  isSkipping?: boolean;
  isRescheduling?: boolean;
}

export function WorkoutActions({
  completionStatus,
  onSkip,
  onReschedule,
  isSkipping = false,
  isRescheduling = false,
}: WorkoutActionsProps) {
  const [activeForm, setActiveForm] = useState<"skip" | "reschedule" | null>(
    null,
  );
  const [skipReason, setSkipReason] = useState("");
  const [newDate, setNewDate] = useState("");

  const isPending =
    completionStatus === "pending" || completionStatus === "partial";
  if (!isPending) return null;

  const isLoading = isSkipping || isRescheduling;

  return (
    <div className="space-y-4">
      {activeForm === null && (
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={isLoading}
            onClick={() => setActiveForm("skip")}
          >
            Skip workout
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={isLoading}
            onClick={() => setActiveForm("reschedule")}
          >
            Reschedule
          </Button>
        </div>
      )}

      {activeForm === "skip" && (
        <div className="space-y-3 rounded-md border border-rule bg-paper p-4">
          <p className="text-sm font-semibold text-ink">Skip this workout</p>
          <p className="text-xs text-ink-soft">
            A short note on why helps your coach adjust what comes next.
            Optional.
          </p>
          <textarea
            value={skipReason}
            onChange={(e) => setSkipReason(e.target.value)}
            placeholder="Under the weather, knee pain, no time…"
            maxLength={500}
            rows={2}
            className="w-full resize-none rounded border border-rule bg-paper-raised px-3 py-2 text-sm text-ink placeholder:text-ink-faint"
          />
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              loading={isSkipping}
              disabled={isLoading}
              onClick={() => {
                onSkip(skipReason.trim() || undefined);
              }}
            >
              Confirm skip
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={isLoading}
              onClick={() => {
                setActiveForm(null);
                setSkipReason("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {activeForm === "reschedule" && (
        <div className="space-y-3 rounded-md border border-rule bg-paper p-4">
          <p className="text-sm font-semibold text-ink">
            Reschedule this workout
          </p>
          <p className="text-xs text-ink-soft">Pick a new date.</p>
          <input
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            min={new Date().toISOString().split("T")[0]}
            className="w-full rounded border border-rule bg-paper-raised px-3 py-2 text-sm text-ink [color-scheme:light]"
          />
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              loading={isRescheduling}
              disabled={isLoading || !newDate}
              onClick={() => {
                if (newDate) {
                  onReschedule(newDate);
                }
              }}
            >
              Confirm reschedule
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={isLoading}
              onClick={() => {
                setActiveForm(null);
                setNewDate("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
