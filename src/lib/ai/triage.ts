/**
 * Haiku triage layer for adaptation decisions.
 *
 * Before calling Sonnet for a full adaptation (~$0.058/call), use Haiku
 * (~$0.0006/call) to decide if workout changes are actually needed.
 *
 * ~40% of medium-severity triggers result in "no changes needed" —
 * the triage layer avoids the expensive Sonnet call in those cases.
 */

import { sendMessage, extractStructuredResult, MODELS } from "@/lib/ai/client";
import type { DecisionResult } from "@/lib/plan-engine/decision-matrix";
import type { ACWRResult, RecoveryReadinessResult } from "@/lib/metrics/derived";
import type { TrainingLoadSummary } from "@/types/metrics";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TriageInput {
  userId?: string;
  /** Pre-computed ACWR */
  acwr: ACWRResult;
  /** Pre-computed recovery readiness */
  recovery: RecoveryReadinessResult;
  /** Decision matrix result (triggers + severity) */
  decision: DecisionResult;
  /** Training load for current week */
  trainingLoad: TrainingLoadSummary;
  /** Current plan phase */
  phase: string;
  /** Weeks into plan */
  currentWeek: number;
  /** Total plan weeks */
  totalWeeks: number;
}

export interface TriageResult {
  /** Whether a full adaptation call should be made */
  shouldAdapt: boolean;
  /** Brief reason for the decision */
  reason: string;
  /** Token usage for cost tracking */
  usage: { inputTokens: number; outputTokens: number };
}

// ---------------------------------------------------------------------------
// Triage tool schema (minimal output for Haiku)
// ---------------------------------------------------------------------------

const TRIAGE_OUTPUT_SCHEMA = {
  type: "object",
  required: ["shouldAdapt", "reason"],
  additionalProperties: false,
  properties: {
    shouldAdapt: {
      type: "boolean",
      description:
        "true if workouts should be modified, false if current plan is fine",
    },
    reason: {
      type: "string",
      description: "One sentence explaining the decision",
    },
  },
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Run a fast Haiku triage to decide if a full Sonnet adaptation call is needed.
 *
 * Skips triage and returns shouldAdapt=true for high-severity triggers
 * (where adaptation is almost certainly needed).
 */
export async function triageAdaptation(
  input: TriageInput,
): Promise<TriageResult> {
  // High severity always needs adaptation — skip the triage call
  if (input.decision.severity === "high") {
    return {
      shouldAdapt: true,
      reason: "High severity triggers — skipping triage, adaptation required.",
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  // Build a compact prompt for Haiku
  const prompt = buildTriagePrompt(input);

  const response = await sendMessage({
    model: MODELS.HAIKU,
    maxTokens: 200,
    system:
      "You are a running coach assistant. Given athlete metrics and trigger reasons, decide if the training plan needs workout modifications. Be conservative — only recommend changes when metrics clearly indicate a problem.",
    messages: [{ role: "user", content: prompt }],
    outputSchema: TRIAGE_OUTPUT_SCHEMA,
    trace: { callsite: "adaptation-triage", userId: input.userId },
  });

  const result = extractStructuredResult<{
    shouldAdapt: boolean;
    reason: string;
  }>(response);

  return {
    shouldAdapt: result?.shouldAdapt ?? true, // Default to adapting if parsing fails
    reason: result?.reason ?? "Triage inconclusive — proceeding with adaptation.",
    usage: {
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
    },
  };
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildTriagePrompt(input: TriageInput): string {
  const lines: string[] = [];

  lines.push("## Athlete Metrics");
  lines.push(
    `ACWR: ${input.acwr.ratio?.toFixed(2) ?? "N/A"} (${input.acwr.riskBand.replace("_", " ")})`,
  );
  lines.push(
    input.recovery.score != null
      ? `Recovery: ${input.recovery.score}/100 (${input.recovery.status})`
      : "Recovery: unknown (no recovery data)",
  );
  lines.push(
    `Training load: ${input.trainingLoad.totalDistanceKm}km this week, ${input.trainingLoad.workoutsCompleted}/${input.trainingLoad.workoutsPlanned} completed, ${input.trainingLoad.workoutsMissed} missed`,
  );
  lines.push(
    `Plan: ${input.phase} phase, week ${input.currentWeek}/${input.totalWeeks}`,
  );
  lines.push("");

  lines.push("## Triggers");
  lines.push(`Severity: ${input.decision.severity}`);
  for (const trigger of input.decision.triggers) {
    lines.push(`- [${trigger.severity}] ${trigger.reason}`);
  }
  lines.push("");

  lines.push(
    "Should the upcoming workouts be modified? Only say yes if the metrics clearly indicate a problem that requires changing the plan.",
  );

  return lines.join("\n");
}
