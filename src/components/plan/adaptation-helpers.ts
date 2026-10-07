import type { AdaptationItem } from "@/lib/query/plan-hooks";

export function getTriggerBadge(trigger: string): {
  label: string;
  className: string;
} {
  const labels: Record<string, string> = {
    weekly_review: "Weekly review",
    missed_workout: "Missed workout",
    unplanned_activity: "Unplanned activity",
    poor_recovery: "Poor recovery",
    user_request: "Your request",
  };
  return {
    label: labels[trigger] ?? trigger,
    className: "bg-paper-shade text-ink-soft",
  };
}

export function isPendingAdaptation(
  adaptation: Pick<AdaptationItem, "accepted" | "supersededAt">,
): boolean {
  return adaptation.accepted === null && adaptation.supersededAt === null;
}

// Urgency comes from the decision matrix's severity; older records without a
// snapshot severity fall back to the number of proposed changes.
export function getSeverityDot(adaptation: AdaptationItem): {
  color: string;
  label: string;
} {
  const snapshotSeverity = parseMetricsSnapshot(adaptation.metricsSnapshot)?.severity;
  const count = adaptation.changes.length;
  const severity =
    snapshotSeverity ?? (count >= 4 ? "high" : count >= 2 ? "medium" : "low");
  if (severity === "high") return { color: "bg-pencil-red", label: "High urgency" };
  if (severity === "medium") return { color: "bg-amber-pencil", label: "Medium urgency" };
  return { color: "bg-sage", label: "Low urgency" };
}

export function getStatusBadge(adaptation: AdaptationItem): {
  label: string;
  className: string;
} | null {
  if (adaptation.supersededAt !== null) {
    return { label: "Replaced", className: "bg-paper-shade text-ink-faint" };
  }
  if (adaptation.accepted === null) return null;
  if (adaptation.accepted) {
    return { label: "Accepted", className: "bg-sage-soft text-sage" };
  }
  return { label: "Declined", className: "bg-paper-shade text-ink-soft" };
}

export function getChangeBadge(change: string): string {
  switch (change) {
    case "added":
      return "bg-sage-soft text-sage";
    case "removed":
      return "bg-amber-soft text-amber-pencil";
    default:
      return "bg-paper-shade text-ink-soft";
  }
}

export interface MetricsSnapshotTrigger {
  type: string;
  reason: string;
  severity: "low" | "medium" | "high";
  metric?: string;
  value?: number;
  threshold?: number;
}

export interface MetricsSnapshotData {
  triggers?: MetricsSnapshotTrigger[];
  acwr?: {
    ratio: number | null;
    riskBand: string;
    acuteLoad: number;
    chronicLoad: number;
  };
  recovery?: {
    score: number | null;
    status: string;
    components?: Record<string, unknown>;
  };
  trainingLoad?: {
    workoutsCompleted: number;
    workoutsPlanned: number;
    workoutsMissed: number;
  };
  severity?: "low" | "medium" | "high";
}

export function parseMetricsSnapshot(
  raw: Record<string, unknown> | null,
): MetricsSnapshotData | null {
  if (!raw) return null;
  return raw as unknown as MetricsSnapshotData;
}

export function toTitleCase(str: string): string {
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getChangeBorderColor(change: string): string {
  switch (change) {
    case "added":
      return "var(--sage)";
    case "removed":
      return "var(--amber-pencil)";
    default:
      return "var(--rule-strong)";
  }
}
