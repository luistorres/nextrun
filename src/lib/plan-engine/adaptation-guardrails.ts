import { startOfWeek, parseISO, format } from "date-fns";
import type {
  AdaptationOutput,
  GeneratedWorkout,
  GeneratedWeek,
  PlanPhase,
  WorkoutStep,
  WorkoutType,
} from "@/types/plan";
import type { HealthConstraint } from "@/types/health";
import {
  runGuardrails,
  isHardWorkout,
  isRunningWorkout,
  type AthleteGuardrailContext,
  type GuardrailViolation,
} from "./guardrails";
import { findUpdatedWorkout } from "./adaptation-applier";

export interface AdaptationWorkoutRow {
  id: string;
  scheduledDate: string;
  dayOfWeek: string;
  workoutType: string;
  title: string;
  description: string | null;
  targetDistanceMeters: number | null;
  targetDurationSeconds: number | null;
  workoutSteps: WorkoutStep[] | null;
}

export interface AdaptationGuardrailInput {
  workouts: AdaptationWorkoutRow[];
  output: AdaptationOutput;
  planPhase: PlanPhase;
  athleteContext?: AthleteGuardrailContext;
  healthConstraints?: HealthConstraint[];
}

export interface AdaptationGuardrailResult {
  rejected: boolean;
  /**
   * Violations the proposal introduces beyond the baseline window:
   * per-rule count increases from runGuardrails plus the quantitative
   * deltas (acwr_hard_session_increase, acwr_volume_increase).
   */
  newViolations: GuardrailViolation[];
  referentialErrors: string[];
  warnings: string[];
  materializedWorkoutCount: number;
  /**
   * Gate-resolved ISO dates for "added" changes, keyed by change index.
   * The adapter persists these into updatedWorkouts[].day so the applier
   * replays the exact date the gate validated.
   */
  resolvedAddedDates: Record<number, string>;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function weekKeyOf(date: string): string {
  return format(startOfWeek(parseISO(date), { weekStartsOn: 1 }), "yyyy-MM-dd");
}

// Same 6:00/km time→distance assumption as guardrails.ts's estimator, but
// local: this one also converts time-based interval work/rest, and changing
// the shared estimator would shift generator-side rule outcomes.
function stepMeters(durationType: string, durationValue?: number): number {
  if (!durationValue) return 0;
  if (durationType === "distance") return durationValue;
  if (durationType === "time") return (durationValue / 360) * 1000;
  return 0;
}

function stepsKm(w: GeneratedWorkout): number {
  let meters = 0;
  for (const step of w.steps) {
    if (step.type === "interval") {
      meters +=
        (stepMeters(step.workStep.durationType, step.workStep.durationValue) +
          stepMeters(step.restStep.durationType, step.restStep.durationValue)) *
        step.repeatCount;
    } else {
      meters += stepMeters(step.durationType, step.durationValue);
    }
  }
  return meters / 1000;
}

// Most pessimistic of the declared target, the steps-based estimate, and the
// duration-based estimate — a proposal can hide volume in whichever field a
// short-circuiting estimate would ignore.
function pessimisticKm(w: GeneratedWorkout): number {
  return Math.max(
    (w.targetDistanceMeters ?? 0) / 1000,
    stepsKm(w),
    (w.targetDurationSeconds ?? 0) / 360,
  );
}

// Interval steps are what Garmin executes — a running workout declared
// easy_run but carrying interval steps is a hard session. Non-running types
// stay soft: aqua-jog intervals are the canonical injured-runner substitution.
function isHardProposal(w: GeneratedWorkout): boolean {
  return (
    isHardWorkout(w.type) ||
    (isRunningWorkout(w.type) && w.steps.some((s) => s.type === "interval"))
  );
}

function matchesConstraint(w: GeneratedWorkout, c: HealthConstraint): boolean {
  if (c.affectedWorkoutTypes.includes(w.type)) return true;
  return (
    c.affectedWorkoutTypes.includes("intervals") &&
    w.steps.some((s) => s.type === "interval")
  );
}

function toGenerated(row: AdaptationWorkoutRow): GeneratedWorkout {
  return {
    day: row.dayOfWeek,
    type: row.workoutType as WorkoutType,
    title: row.title,
    description: row.description ?? "",
    targetDistanceMeters: row.targetDistanceMeters ?? undefined,
    targetDurationSeconds: row.targetDurationSeconds ?? undefined,
    steps: row.workoutSteps ?? [],
  };
}

function buildWeeks(
  entries: Map<string, GeneratedWorkout>,
  weekOf: Map<string, string>,
  phase: PlanPhase,
): GeneratedWeek[] {
  const weekKeys = [...new Set(weekOf.values())].sort();
  // weeklyMileageTargetKm stays 0 on purpose: the window is partial calendar
  // weeks, so target-based rules (volume_progression_cap,
  // acwr_high_risk_mileage_cap) must stay inert here — the quantitative
  // acwr_volume_increase delta covers volume safety instead.
  return weekKeys.map((key, i) => ({
    weekNumber: i + 1,
    phase,
    weeklyMileageTargetKm: 0,
    workouts: [...entries.entries()]
      .filter(([id]) => weekOf.get(id) === key)
      .map(([, w]) => w),
  }));
}

function violationCounts(violations: GuardrailViolation[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const v of violations) counts.set(v.rule, (counts.get(v.rule) ?? 0) + 1);
  return counts;
}

/**
 * Delta guardrail gate for adaptation proposals: guardrails run on the
 * baseline window and on the proposal-materialized window; only violations
 * whose per-rule count INCREASES gate the proposal. Pre-existing violations
 * (elevated ACWR, an already-scheduled constrained workout) never block —
 * otherwise the gate would reject precisely the proposals meant to fix them.
 * The materializer mirrors adaptation-applier semantics: rescheduled is a
 * no-op there, so it is a no-op here.
 */
export function checkAdaptationGuardrails(
  input: AdaptationGuardrailInput,
): AdaptationGuardrailResult {
  const { workouts, output } = input;
  const updated = output.updatedWorkouts ?? [];

  const knownIds = new Set(workouts.map((w) => w.id));
  const nonAdded = output.changes.filter((c) => c.change !== "added");
  const idCounts = new Map<string, number>();
  for (const c of nonAdded) {
    idCounts.set(c.workoutId, (idCounts.get(c.workoutId) ?? 0) + 1);
  }
  const referentialErrors = [
    ...nonAdded
      .filter((c) => !knownIds.has(c.workoutId))
      .map((c) => `change "${c.change}" references unknown workout ${c.workoutId}`),
    // The applier executes every change: a removed+replaced pair on one id
    // would re-insert a workout the gate saw as deleted.
    ...[...idCounts]
      .filter(([, n]) => n > 1)
      .map(([id]) => `duplicate changes for workout ${id}`),
  ];

  const dateOf = new Map(workouts.map((w) => [w.id, w.scheduledDate]));
  const weekOf = new Map(
    [...dateOf].map(([id, date]) => [id, weekKeyOf(date)]),
  );
  const todayISO = format(new Date(), "yyyy-MM-dd");

  const baseline = new Map(workouts.map((w) => [w.id, toGenerated(w)]));
  const proposed = new Map(baseline);
  const changedIds = new Set<string>();
  const resolvedAddedDates: Record<number, string> = {};

  output.changes.forEach((change, i) => {
    switch (change.change) {
      case "removed":
        proposed.delete(change.workoutId);
        break;
      case "modified":
      case "replaced": {
        const sub = findUpdatedWorkout(change, updated);
        const original = baseline.get(change.workoutId);
        if (sub && original && proposed.has(change.workoutId)) {
          // Mirrors the applier's column inheritance: omitted numeric targets
          // keep the original's values (modified leaves the column untouched,
          // replaced falls back to the original row). The day is always the
          // original's — the applier never moves these branches, so a lying
          // sub.day must not shift day-based checks.
          proposed.set(change.workoutId, {
            ...sub,
            day: original.day,
            targetDistanceMeters:
              sub.targetDistanceMeters ?? original.targetDistanceMeters,
            targetDurationSeconds:
              sub.targetDurationSeconds ?? original.targetDurationSeconds,
          });
          changedIds.add(change.workoutId);
        }
        break;
      }
      case "added": {
        const sub = findUpdatedWorkout(change, updated);
        if (sub) {
          // Index-keyed: two "added" changes sharing a workoutId must not
          // collapse — the applier inserts every one of them.
          const syntheticId = `added-${i}`;
          // Mirrors the applier's date resolution: a literal yyyy-MM-dd day
          // schedules on that date, anything else lands on today.
          const resolvedDate = ISO_DATE.test(sub.day) ? sub.day : todayISO;
          proposed.set(syntheticId, sub);
          dateOf.set(syntheticId, resolvedDate);
          weekOf.set(syntheticId, weekKeyOf(resolvedDate));
          changedIds.add(syntheticId);
          resolvedAddedDates[i] = resolvedDate;
        } else {
          // The applier would insert an easy_run stub the gate never saw.
          referentialErrors.push(
            `added change ${change.workoutId} has no matching updatedWorkouts entry`,
          );
        }
        break;
      }
      case "rescheduled":
        break;
    }
  });

  const phase = input.planPhase;
  const run = (entries: Map<string, GeneratedWorkout>) => {
    const weeks = buildWeeks(entries, weekOf, phase);
    // athleteContext deliberately NOT passed: rule 7a's hard-session
    // auto-downgrade mutates the plan before rule 10 counts health
    // violations, which would skew the baseline/proposed count-diff.
    // ACWR gating happens in the quantitative deltas below instead.
    return runGuardrails(
      {
        totalWeeks: weeks.length,
        phases: [{ phase, startWeek: 1, endWeek: weeks.length }],
        weeks,
      },
      undefined,
      "experienced",
      undefined,
      input.healthConstraints,
    );
  };

  const baselineResult = run(baseline);
  const proposedResult = run(proposed);

  const baseCounts = violationCounts(baselineResult.violations);
  const seen = new Map<string, number>();
  // health_constraint_avoid is excluded: the dated direct check below owns
  // health gating — the backstop evaluates constraints against today, which
  // false-rejects changes dated past a constraint's expiry.
  const newViolations = proposedResult.violations.filter((v) => {
    if (v.rule === "health_constraint_avoid") return false;
    const n = (seen.get(v.rule) ?? 0) + 1;
    seen.set(v.rule, n);
    return n > (baseCounts.get(v.rule) ?? 0);
  });

  // Direct dated health check on changed workouts only: introduction via a
  // changed workout rejects even when a same-count swap fools count-diffing.
  // A workout whose baseline already matched the same constraint never fires
  // (delta principle: shrinking an existing hills workout must pass).
  const avoidConstraints = (input.healthConstraints ?? []).filter(
    (c) => c.severity === "avoid",
  );
  for (const id of changedIds) {
    const w = proposed.get(id);
    const date = dateOf.get(id);
    if (!w || !date) continue;
    const before = baseline.get(id);
    for (const c of avoidConstraints) {
      if (c.activeFrom && c.activeFrom > date) continue;
      if (c.activeUntil && c.activeUntil < date) continue;
      if (!matchesConstraint(w, c)) continue;
      if (before && matchesConstraint(before, c)) continue;
      newViolations.push({
        rule: "health_constraint_avoid",
        directive: `"${w.title}" (${date}) is ${w.type} — constraint "${c.label}" requires avoiding this workout type`,
      });
    }
  }

  // Quantitative deltas: acwr_overload fires at most once (first week only)
  // and the zeroed targets blind the volume rules, so count-diffing alone
  // misses "already bad, made worse". Compare per-week hard-session counts
  // and estimated km directly.
  const ratio = input.athleteContext?.acwr?.ratio;
  if (ratio != null && ratio > 1.3) {
    const weekKeys = [...new Set(weekOf.values())].sort();
    for (const key of weekKeys) {
      const inWeek = (m: Map<string, GeneratedWorkout>) =>
        [...m.entries()].filter(([id]) => weekOf.get(id) === key).map(([, w]) => w);
      const baseWeek = inWeek(baseline);
      const propWeek = inWeek(proposed);

      const baseHard = baseWeek.filter(isHardProposal).length;
      const propHard = propWeek.filter(isHardProposal).length;
      // propHard > 1 mirrors rule 7's allowance of a single quality session.
      if (propHard > baseHard && propHard > 1) {
        newViolations.push({
          rule: "acwr_hard_session_increase",
          directive: `ACWR is ${ratio.toFixed(2)} — the proposal must not add hard sessions (week of ${key}: +${propHard - baseHard})`,
        });
      }

      const longKm = (ws: GeneratedWorkout[]) =>
        ws
          .filter((w) => w.type === "long_run")
          .reduce((sum, w) => sum + pessimisticKm(w), 0);
      if (longKm(propWeek) > longKm(baseWeek) * 1.05) {
        newViolations.push({
          rule: "acwr_long_run_increase",
          directive: `ACWR is ${ratio.toFixed(2)} — the proposal must not increase long-run volume (week of ${key})`,
        });
      }

      if (ratio > 1.5) {
        const runKm = (ws: GeneratedWorkout[]) =>
          ws
            .filter((w) => isRunningWorkout(w.type))
            .reduce((sum, w) => sum + pessimisticKm(w), 0);
        const baseKm = runKm(baseWeek);
        // Floor: adding a short recovery jog to an empty week is not a spike.
        const cap = baseKm === 0 ? 3 : baseKm * 1.05;
        if (runKm(propWeek) > cap) {
          newViolations.push({
            rule: "acwr_volume_increase",
            directive: `ACWR is ${ratio.toFixed(2)} — the proposal must not increase weekly volume (week of ${key})`,
          });
        }
      }
    }
  }

  return {
    rejected: referentialErrors.length > 0 || newViolations.length > 0,
    newViolations,
    referentialErrors,
    warnings: proposedResult.warnings,
    materializedWorkoutCount: proposed.size,
    resolvedAddedDates,
  };
}
