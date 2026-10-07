"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  useAdaptations,
  useAcceptAdaptation,
  useRejectAdaptation,
} from "@/lib/query/plan-hooks";
import {
  getTriggerBadge,
  getSeverityDot,
  isPendingAdaptation,
} from "@/components/plan/adaptation-helpers";

export function PendingAdaptationBanner() {
  const { data } = useAdaptations();
  const acceptMutation = useAcceptAdaptation();
  const rejectMutation = useRejectAdaptation();

  const pending = data?.adaptations.filter(isPendingAdaptation) ?? [];

  if (pending.length === 0) return null;

  const isMutating = acceptMutation.isPending || rejectMutation.isPending;

  if (pending.length > 1) {
    return (
      <Link
        href="/dashboard/adaptations"
        className="block rounded-md border border-rule bg-paper-raised px-5 py-3.5 transition-colors hover:border-rule-strong"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">
              <span className="font-mono tabular-nums">{pending.length}</span>{" "}
              plan changes waiting for review
            </p>
            <p className="text-xs text-ink-soft">
              Your coach proposed adjustments. Review when ready.
            </p>
          </div>
          <span className="shrink-0 text-sm text-ink-soft" aria-hidden="true">
            &rarr;
          </span>
        </div>
      </Link>
    );
  }

  const adaptation = pending[0];
  const trigger = getTriggerBadge(adaptation.triggerType);
  const severity = getSeverityDot(adaptation);

  return (
    <div className="rounded-md border border-rule bg-paper-raised">
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="stamp text-[11px] text-ink-soft">
              {trigger.label}
            </span>
            <span className="text-xs text-ink-soft">
              {severity.label.toLowerCase()} &middot;{" "}
              <span className="font-mono tabular-nums">
                {adaptation.changes.length}
              </span>{" "}
              change{adaptation.changes.length !== 1 ? "s" : ""}
            </span>
          </div>
          <p className="mt-1.5 line-clamp-1 text-sm text-ink">
            {(() => {
              try {
                const parsed = JSON.parse(adaptation.explanation);
                if (parsed?.summary) return parsed.context || parsed.summary;
              } catch { /* legacy plain text */ }
              return adaptation.explanation;
            })()}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={isMutating}
            loading={rejectMutation.isPending}
            onClick={() => rejectMutation.mutate(adaptation.id)}
          >
            Reject
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={isMutating}
            loading={acceptMutation.isPending}
            onClick={() => acceptMutation.mutate(adaptation.id)}
          >
            Accept
          </Button>
          <Link
            href="/dashboard/adaptations"
            className="ml-1 text-xs font-medium text-ink-soft underline-offset-2 transition-colors hover:text-ink hover:underline"
          >
            Details &rarr;
          </Link>
        </div>
      </div>
    </div>
  );
}
