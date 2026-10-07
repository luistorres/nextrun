/**
 * Structured health and injury constraint types.
 *
 * Replaces free-text `constraints` field with typed data that enables
 * deterministic guardrail enforcement and richer AI context injection.
 *
 * Inspired by SSKG contraindication encoding from He et al. (2026).
 */

export interface HealthConstraint {
  /** Stable identifier for this constraint */
  id: string;
  category: "injury" | "chronic_condition" | "equipment" | "lifestyle";
  /** Human-readable label (e.g. "Left knee patellofemoral pain") */
  label: string;
  /**
   * Workout types affected by this constraint.
   * Maps to WorkoutType values from @/types/plan.
   */
  affectedWorkoutTypes: string[];
  /**
   * Enforcement level:
   * - avoid: Guardrail will auto-substitute affected workout types
   * - modify: Warning only — AI should adjust intensity/duration
   * - monitor: Informational — no automatic changes
   */
  severity: "avoid" | "modify" | "monitor";
  /** Optional free-text notes for AI context */
  notes?: string;
  /** ISO date when constraint became active (defaults to always active) */
  activeFrom?: string;
  /** ISO date when constraint expires (absent = ongoing) */
  activeUntil?: string;
}
