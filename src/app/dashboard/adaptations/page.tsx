"use client";

import { useState } from "react";
import { useAdaptations } from "@/lib/query/plan-hooks";
import { AdaptationCard } from "@/components/plan/adaptation-card";
import { isPendingAdaptation } from "@/components/plan/adaptation-helpers";
import { Button } from "@/components/ui/button";
import { RequestAdaptationModal } from "@/components/plan/request-adaptation-modal";

export default function AdaptationsPage() {
  const { data, isLoading, error } = useAdaptations();
  const [showRequestModal, setShowRequestModal] = useState(false);

  return (
    <div className="space-y-6 pb-20 lg:pb-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink">Plan changes</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Every adjustment your coach has made, and why.
          </p>
        </div>
        {data && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowRequestModal(true)}
          >
            Request review
          </Button>
        )}
      </div>

      <RequestAdaptationModal
        open={showRequestModal}
        onOpenChange={setShowRequestModal}
      />

      {isLoading && <LoadingSkeleton />}

      {error && !isLoading && (
        <EmptyLedger line="No plan yet, so nothing to change. Once a plan is running, adjustments and their reasoning land here." />
      )}

      {data && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-rule bg-paper-raised px-5 py-3">
            <SummaryStat label="total" count={data.adaptations.length} />
            <SummaryStat
              label="pending"
              count={data.adaptations.filter(isPendingAdaptation).length}
            />
            <SummaryStat
              label="accepted"
              count={data.adaptations.filter((a) => a.accepted === true).length}
            />
            <SummaryStat
              label="declined"
              count={
                data.adaptations.filter((a) => a.accepted === false).length
              }
            />
            <SummaryStat
              label="replaced"
              count={
                data.adaptations.filter((a) => a.supersededAt !== null).length
              }
            />
            <span className="ml-auto text-xs text-ink-faint">
              Plan v{data.planVersion}
            </span>
          </div>

          {data.adaptations.length === 0 ? (
            <EmptyLedger line="Nothing to review yet. As you train, your coach watches recovery, load, and compliance — when something needs adjusting, the change and its reasoning land here. First changes usually appear after your first full week." />
          ) : (
            <div className="space-y-4">
              {data.adaptations.map((adaptation) => (
                <AdaptationCard key={adaptation.id} adaptation={adaptation} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SummaryStat({ label, count }: { label: string; count: number }) {
  return (
    <span className="text-xs text-ink-soft">
      <span className="font-mono font-semibold tabular-nums text-ink">
        {count}
      </span>{" "}
      {label}
    </span>
  );
}

function EmptyLedger({ line }: { line: string }) {
  return (
    <div className="rounded-md border border-rule bg-paper-raised">
      {[0, 1, 2].map((i) => (
        <div key={i} className="border-b border-rule px-5 py-3.5">
          <div className="h-4 w-2/5 rounded-sm bg-paper-shade" />
        </div>
      ))}
      <p className="max-w-prose px-5 py-4 text-sm leading-relaxed text-ink-soft">
        {line}
      </p>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="skeleton h-11 w-full" />
      {[1, 2, 3].map((i) => (
        <div key={i} className="skeleton h-48 w-full" />
      ))}
    </div>
  );
}
