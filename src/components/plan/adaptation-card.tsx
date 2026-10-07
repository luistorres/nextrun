"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  useAcceptAdaptation,
  useRejectAdaptation,
} from "@/lib/query/plan-hooks";
import type { AdaptationItem } from "@/lib/query/plan-hooks";
import {
  getTriggerBadge,
  getSeverityDot,
  getStatusBadge,
  isPendingAdaptation,
  getChangeBadge,
  getChangeBorderColor,
  parseMetricsSnapshot,
  toTitleCase,
} from "@/components/plan/adaptation-helpers";
import type {
  MetricsSnapshotData,
  MetricsSnapshotTrigger,
} from "@/components/plan/adaptation-helpers";

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface StructuredExplanation {
  summary: string;
  context?: string;
  keyPoints: string[];
  outlook?: string;
}

function parseExplanation(
  raw: string,
):
  | { structured: true; data: StructuredExplanation }
  | { structured: false; text: string } {
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.summary === "string" &&
      Array.isArray(parsed.keyPoints)
    ) {
      return { structured: true, data: parsed as StructuredExplanation };
    }
  } catch {
    // Not JSON — legacy plain text
  }
  return { structured: false, text: raw };
}

interface AdaptationCardProps {
  adaptation: AdaptationItem;
}

export function AdaptationCard({ adaptation }: AdaptationCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showRejectConfirm, setShowRejectConfirm] = useState(false);
  const acceptMutation = useAcceptAdaptation();
  const rejectMutation = useRejectAdaptation();

  const trigger = getTriggerBadge(adaptation.triggerType);
  const severity = getSeverityDot(adaptation);
  const statusBadge = getStatusBadge(adaptation);
  const isPending = isPendingAdaptation(adaptation);
  const isMutating = acceptMutation.isPending || rejectMutation.isPending;

  return (
    <article className="rounded-md border border-rule bg-paper-raised shadow-[0_1px_4px_rgba(38,36,31,0.06)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-rule px-5 py-3">
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium ${trigger.className}`}
        >
          {trigger.label}
        </span>

        <span className="flex items-center gap-1.5 text-xs text-ink-soft">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${severity.color}`}
          />
          {severity.label}
        </span>

        {statusBadge && (
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ${statusBadge.className}`}
          >
            {statusBadge.label}
          </span>
        )}

        <span className="ml-auto text-xs text-ink-faint">
          {formatDate(adaptation.createdAt)}
        </span>
      </div>

      <div className="px-5 py-4">
        {adaptation.triggerType === "user_request" && adaptation.userContext && (
          <div className="mb-4 border-l-2 border-rule-strong py-0.5 pl-3.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
              Your request
            </p>
            <p className="mt-1 text-sm text-ink-soft">
              &ldquo;{adaptation.userContext}&rdquo;
            </p>
          </div>
        )}

        <ExplanationSection
          raw={adaptation.explanation}
          expanded={expanded}
          onToggle={() => setExpanded(!expanded)}
        />

        <p className="mt-2 text-xs text-ink-faint">
          Plan v{adaptation.oldPlanVersion} &rarr; v{adaptation.newPlanVersion}
        </p>

        {adaptation.supersededAt !== null && (
          <p className="mt-2 text-xs text-ink-soft">
            A newer proposal replaced this one before you answered, so it was
            never applied.
          </p>
        )}

        <MetricsSnapshotSection
          snapshot={parseMetricsSnapshot(adaptation.metricsSnapshot)}
          defaultExpanded={isPending}
        />

        {adaptation.changes.length > 0 && (
          <div className="mt-5">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
              Changes
              <span className="ml-1.5 font-normal lowercase">
                ({adaptation.changes.length})
              </span>
            </h4>
            <div className="divide-y divide-rule border-t border-rule">
              {adaptation.changes.map((change, idx) => (
                <div
                  key={idx}
                  className="py-2.5 pl-3"
                  style={{
                    borderLeft: `2px solid ${getChangeBorderColor(change.change)}`,
                  }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase ${getChangeBadge(change.change)}`}
                    >
                      {change.change}
                    </span>
                    {change.from && (
                      <span className="text-xs text-ink-faint line-through">
                        {change.from}
                      </span>
                    )}
                    {change.from && change.to && (
                      <span className="text-xs text-ink-faint">&rarr;</span>
                    )}
                    {change.to && (
                      <span className="text-xs font-medium text-ink">
                        {change.to}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-ink-soft">
                    {change.reason}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {isPending && (
        <div className="flex items-center justify-end gap-3 border-t border-rule px-5 py-3">
          <Button
            variant="outline"
            size="sm"
            disabled={isMutating}
            loading={rejectMutation.isPending}
            onClick={() => setShowRejectConfirm(true)}
          >
            Decline
          </Button>
          <ConfirmDialog
            open={showRejectConfirm}
            onOpenChange={setShowRejectConfirm}
            title="Decline this change?"
            description="The proposed changes will be discarded and your current plan stays as written. You can request a new review later."
            confirmLabel="Decline"
            cancelLabel="Keep"
            variant="destructive"
            onConfirm={() => rejectMutation.mutate(adaptation.id)}
          />
          <Button
            variant="primary"
            size="sm"
            disabled={isMutating}
            loading={acceptMutation.isPending}
            onClick={() => acceptMutation.mutate(adaptation.id)}
          >
            Accept
          </Button>
        </div>
      )}

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {acceptMutation.isSuccess ? "Change accepted" : ""}
        {rejectMutation.isSuccess ? "Change declined" : ""}
        {acceptMutation.isError ? "Accepting failed — try again" : ""}
        {rejectMutation.isError ? "Declining failed — try again" : ""}
      </div>
    </article>
  );
}

function ExplanationSection({
  raw,
  expanded,
  onToggle,
}: {
  raw: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const parsed = parseExplanation(raw);

  if (!parsed.structured) {
    return (
      <>
        <p
          className={`coach-note text-sm leading-relaxed ${
            !expanded && parsed.text.length > 200 ? "line-clamp-3" : ""
          }`}
        >
          {parsed.text}
        </p>
        {parsed.text.length > 200 && (
          <button
            onClick={onToggle}
            className="mt-1 text-xs font-medium text-ink-soft underline underline-offset-2 hover:text-ink"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        )}
      </>
    );
  }

  const { summary, context, keyPoints, outlook } = parsed.data;

  return (
    <div className="space-y-3">
      <p className="coach-note text-[15px] font-medium leading-snug">
        {summary}
      </p>

      {context && (
        <p className="max-w-prose text-sm leading-relaxed text-ink-soft">
          {context}
        </p>
      )}

      {keyPoints.length > 0 && (
        <ul className="space-y-1.5">
          {keyPoints.map((point, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <span className="mt-[8px] h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
              <span className="text-sm leading-relaxed text-ink-soft">
                {point}
              </span>
            </li>
          ))}
        </ul>
      )}

      {outlook && (
        <p className="max-w-prose border-l-2 border-rule py-0.5 pl-3 text-xs leading-relaxed text-ink-soft">
          {outlook}
        </p>
      )}
    </div>
  );
}

const ACWR_SCALE = [
  { min: 0, max: 0.79, label: "Undertrained", range: "< 0.8", color: "var(--rule-strong)" },
  { min: 0.8, max: 1.3, label: "Sweet spot", range: "0.8–1.3", color: "var(--sage)" },
  { min: 1.31, max: 1.5, label: "Caution", range: "1.3–1.5", color: "var(--amber-pencil)" },
  { min: 1.51, max: 99, label: "Rapid ramp", range: "> 1.5", color: "var(--pencil-red)" },
] as const;

function InfoPanel({
  onClose,
  children,
  scale,
  value,
}: {
  onClose: () => void;
  children: React.ReactNode;
  scale: readonly {
    min: number;
    max: number;
    label: string;
    range: string;
    color: string;
  }[];
  value?: number;
}) {
  return (
    <div className="mt-2.5 rounded-md border border-rule bg-paper px-4 py-3.5">
      <div className="flex items-start gap-3">
        <div className="text-xs leading-relaxed text-ink-soft">{children}</div>
        <button
          type="button"
          onClick={onClose}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
          }}
          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-paper-shade"
          aria-label="Close"
        >
          <svg width="8" height="8" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path
              d="M1 1l8 8M9 1l-8 8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      <div className="mt-3.5 flex gap-0.5">
        {scale.map((tier) => {
          const isActive =
            value != null && value >= tier.min && value <= tier.max;
          return (
            <div key={tier.label} className="flex-1">
              <div
                className="h-1 rounded-full"
                style={{
                  background: isActive ? tier.color : "var(--paper-shade)",
                }}
              />
              <p
                className="mt-1.5 text-center text-[10px] font-medium"
                style={{ color: isActive ? tier.color : "var(--ink-faint)" }}
              >
                {tier.label}
              </p>
              <p className="text-center text-[9px] tabular-nums text-ink-faint">
                {tier.range}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ACWRInfoSection({
  ratio,
  onClose,
}: {
  ratio?: number;
  onClose: () => void;
}) {
  return (
    <InfoPanel onClose={onClose} scale={ACWR_SCALE} value={ratio}>
      <p>
        <span className="font-semibold text-ink">ACWR</span> (Acute:Chronic
        Workload Ratio) compares your last 7 days of training load against your
        28-day rolling average &mdash; how fast your training is ramping
        relative to what your body is used to. 0.8&ndash;1.3 means your load
        matches your base. Above 1.3, your coach gets conservative with
        intensity; above 1.5, load is climbing much faster than your base and
        the coach holds it steady until things settle.
      </p>
    </InfoPanel>
  );
}

// Must match RECOVERY_THRESHOLDS in src/lib/metrics/derived.ts (70/50/30)
const RECOVERY_SCALE = [
  { min: 0, max: 29, label: "Depleted", range: "< 30", color: "var(--pencil-red)" },
  { min: 30, max: 49, label: "Fatigued", range: "30–50", color: "var(--amber-pencil)" },
  { min: 50, max: 69, label: "Moderate", range: "50–70", color: "var(--amber-pencil)" },
  { min: 70, max: 100, label: "Ready", range: "≥ 70", color: "var(--sage)" },
] as const;

function RecoveryInfoSection({
  score,
  onClose,
}: {
  score?: number;
  onClose: () => void;
}) {
  return (
    <InfoPanel onClose={onClose} scale={RECOVERY_SCALE} value={score}>
      <p>
        <span className="font-semibold text-ink">Recovery readiness</span> is a
        0&ndash;100 composite score that estimates how prepared your body is
        for training stress. It is calculated from four signals:
      </p>
      <ul className="mt-1.5 list-inside list-disc space-y-0.5">
        <li>
          <span className="text-ink">HRV trend</span> &mdash; higher and stable
          HRV indicates parasympathetic recovery
        </li>
        <li>
          <span className="text-ink">Sleep quality</span> &mdash; deep sleep
          duration and overall sleep score
        </li>
        <li>
          <span className="text-ink">Body Battery</span> &mdash; Garmin&apos;s
          energy reserve estimate at wake-up
        </li>
        <li>
          <span className="text-ink">Stress levels</span> &mdash; lower average
          stress supports faster recovery
        </li>
      </ul>
      <p className="mt-2">
        70 and above = ready for quality sessions. 50&ndash;70 = moderate,
        proceed with planned work. 30&ndash;50 = fatigued &mdash; the coach
        reduces intensity. Below 30 = depleted &mdash; easy running or rest
        only.
      </p>
    </InfoPanel>
  );
}

const COMPLIANCE_SCALE = [
  { min: 0, max: 59, label: "Low", range: "< 60%", color: "var(--amber-pencil)" },
  { min: 60, max: 79, label: "Moderate", range: "60–80%", color: "var(--amber-pencil)" },
  { min: 80, max: 90, label: "Ideal", range: "~80%", color: "var(--sage)" },
  { min: 91, max: 100, label: "High", range: "> 90%", color: "var(--sage)" },
] as const;

function ComplianceInfoSection({
  rate,
  onClose,
}: {
  rate?: number;
  onClose: () => void;
}) {
  return (
    <InfoPanel onClose={onClose} scale={COMPLIANCE_SCALE} value={rate}>
      <p>
        <span className="font-semibold text-ink">Plan compliance</span> tracks
        the percentage of planned workouts you&apos;ve completed as prescribed.
        It directly influences how the coach adapts your plan:
      </p>
      <ul className="mt-1.5 list-inside list-disc space-y-0.5">
        <li>
          <span className="text-ink">Below 60%</span> &mdash; plan may be too
          demanding; the coach reduces volume or swaps sessions to fit your
          schedule
        </li>
        <li>
          <span className="text-ink">60&ndash;80%</span> &mdash; moderate
          adherence; minor adjustments may be made
        </li>
        <li>
          <span className="text-ink">~80%</span> &mdash; ideal target; enough
          consistency for fitness gains with flexibility for life
        </li>
        <li>
          <span className="text-ink">Above 90%</span> &mdash; strong execution;
          the coach may add progression if recovery allows
        </li>
      </ul>
      <p className="mt-2">
        Missing individual workouts is normal. The coach looks at your rolling
        2-week compliance trend, not isolated missed days.
      </p>
    </InfoPanel>
  );
}

type AlertDirection = "below" | "above" | "atLeast";

const percent = (v: number) => `${Math.round(v)}%`;
const signedPercent = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v)}%`;

// `direction` mirrors the comparison the decision matrix uses to fire each
// trigger, so the row can say which side of the threshold is the problem.
const METRIC_DISPLAY: Record<
  string,
  {
    label: string;
    value: (v: number) => string;
    limit: (v: number) => string;
    direction: AlertDirection;
  }
> = {
  acwr: {
    label: "Acute Chronic Load Ratio (ACWR)",
    value: (v) => v.toFixed(2),
    limit: (v) => v.toFixed(2),
    direction: "above",
  },
  recoveryReadiness: {
    label: "Recovery",
    value: (v) => `${Math.round(v)}/100`,
    limit: (v) => String(Math.round(v)),
    direction: "below",
  },
  sleepQuality: {
    label: "Sleep quality",
    value: (v) => `${Math.round(v)}/100`,
    limit: (v) => String(Math.round(v)),
    direction: "below",
  },
  sleepDuration: {
    label: "Sleep duration",
    value: (v) => `${v.toFixed(1)} h`,
    limit: (v) => `${v} h`,
    direction: "below",
  },
  missedWorkouts: {
    label: "Missed workouts",
    value: (v) => String(v),
    limit: (v) => String(v),
    direction: "atLeast",
  },
  complianceRate: {
    label: "Compliance",
    value: percent,
    limit: percent,
    direction: "below",
  },
  workout_execution_ratio: {
    label: "Workout execution",
    value: (v) => percent(v * 100),
    limit: (v) => percent(v * 100),
    direction: "below",
  },
  stress: {
    label: "Stress vs baseline",
    value: signedPercent,
    limit: signedPercent,
    direction: "above",
  },
  weeklyLoadSpike: {
    label: "Weekly load change",
    value: signedPercent,
    limit: signedPercent,
    direction: "atLeast",
  },
  rpeScore: {
    label: "Effort (RPE, 7-day avg)",
    value: (v) => `${v.toFixed(1)}/10`,
    limit: (v) => String(v),
    direction: "atLeast",
  },
};

function describeAlert(direction: AlertDirection, limit: string): string {
  if (direction === "below") return `Alert below ${limit}`;
  if (direction === "above") return `Alert above ${limit}`;
  return `Alert at ${limit} or more`;
}

function humanizeMetric(metric: string): string {
  const words = metric.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

function MetricsSnapshotSection({
  snapshot,
  defaultExpanded,
}: {
  snapshot: MetricsSnapshotData | null;
  defaultExpanded: boolean;
}) {
  const [open, setOpen] = useState(defaultExpanded);

  if (!snapshot) return null;

  const triggers = snapshot.triggers ?? [];
  const hasContent =
    triggers.length > 0 ||
    snapshot.acwr ||
    snapshot.recovery ||
    snapshot.trainingLoad;

  if (!hasContent) return null;

  return (
    <div className="mt-4">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint transition-colors hover:text-ink"
      >
        <svg
          className="h-3 w-3 transition-transform duration-200"
          style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path d="M2 4l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        What triggered this
      </button>

      {open && (
        <div className="mt-3 space-y-1.5">
          <div className="divide-y divide-rule rounded border border-rule bg-paper">
            {triggers.map((t, idx) => (
              <TriggerItem key={t.metric ?? `${t.type}-${idx}`} trigger={t} />
            ))}
          </div>

          {(snapshot.acwr || snapshot.recovery || snapshot.trainingLoad) && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded border border-rule bg-paper px-3 py-2.5">
              {snapshot.acwr?.ratio != null && (
                <span className="text-xs text-ink-soft">
                  ACWR{" "}
                  <span className="font-mono font-semibold tabular-nums text-ink">
                    {snapshot.acwr.ratio.toFixed(2)}
                  </span>{" "}
                  <span className="text-ink-faint">
                    {snapshot.acwr.riskBand.replace(/_/g, " ")}
                  </span>
                </span>
              )}
              {snapshot.recovery?.score != null && (
                <span className="text-xs text-ink-soft">
                  Recovery{" "}
                  <span className="font-mono font-semibold tabular-nums text-ink">
                    {Math.round(snapshot.recovery.score)}/100
                  </span>
                </span>
              )}
              {snapshot.trainingLoad && (
                <span className="text-xs text-ink-soft">
                  Compliance{" "}
                  <span className="font-mono font-semibold tabular-nums text-ink">
                    {snapshot.trainingLoad.workoutsCompleted}/
                    {snapshot.trainingLoad.workoutsPlanned}
                  </span>
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const METRICS_WITH_INFO = new Set([
  "acwr",
  "recoveryReadiness",
  "complianceRate",
]);

function TriggerItem({ trigger: t }: { trigger: MetricsSnapshotTrigger }) {
  const [showInfo, setShowInfo] = useState(false);

  const display = t.metric ? METRIC_DISPLAY[t.metric] : undefined;
  const hasInfo = t.metric != null && METRICS_WITH_INFO.has(t.metric);
  const label =
    display?.label ??
    (t.metric ? humanizeMetric(t.metric) : toTitleCase(t.type.replace(/_/g, " ")));
  const value =
    t.value == null ? null : display ? display.value(t.value) : String(t.value);
  const alert =
    display && t.threshold != null
      ? describeAlert(display.direction, display.limit(t.threshold))
      : null;

  return (
    <div className="px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-xs font-medium text-ink">{label}</span>
          {hasInfo && (
            <button
              type="button"
              onClick={() => setShowInfo((prev) => !prev)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setShowInfo(false);
              }}
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px] font-bold leading-none transition-colors ${
                showInfo
                  ? "border-pencil-red text-pencil-red"
                  : "border-rule-strong text-ink-faint hover:text-ink-soft"
              }`}
              aria-label={`What is ${label}?`}
            >
              ?
            </button>
          )}
        </div>

        {value && (
          <div className="shrink-0 text-right">
            <span className="block font-mono text-xs font-semibold tabular-nums text-ink">
              {value}
            </span>
            {alert && (
              <span className="block text-[11px] text-ink-faint">{alert}</span>
            )}
          </div>
        )}
      </div>

      <p className="mt-1 text-[11px] leading-snug text-ink-soft">{t.reason}</p>

      {showInfo && t.metric === "acwr" && (
        <ACWRInfoSection ratio={t.value} onClose={() => setShowInfo(false)} />
      )}
      {showInfo && t.metric === "recoveryReadiness" && (
        <RecoveryInfoSection
          score={t.value}
          onClose={() => setShowInfo(false)}
        />
      )}
      {showInfo && t.metric === "complianceRate" && (
        <ComplianceInfoSection
          rate={t.value}
          onClose={() => setShowInfo(false)}
        />
      )}
    </div>
  );
}
