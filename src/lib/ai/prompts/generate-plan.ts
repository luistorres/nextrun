/**
 * Plan generation prompt template.
 *
 * Builds a detailed user message for Claude given a PlanGenerationInput,
 * training paces, periodization, and an optional AthleteAnalysis.
 *
 * The AthleteAnalysis replaces raw health data dumps with pre-interpreted
 * derived metrics (ACWR, recovery readiness, sleep quality, pace efficiency).
 */

import type { PlanGenerationInput } from "@/types/plan";
import type { TrainingPaces } from "@/lib/plan-engine/pace-calculator";
import { formatPace } from "@/lib/plan-engine/pace-calculator";
import type { PeriodizationPlan } from "@/lib/plan-engine/periodization";
import type { AthleteAnalysis } from "@/lib/metrics/athlete-analysis";
import { formatAnalysisForPrompt } from "@/lib/metrics/athlete-analysis";
import type { HealthConstraint } from "@/types/health";
import { getRelevantKnowledge, formatKnowledgeForPrompt } from "@/lib/plan-engine/exercise-knowledge";

// ---------------------------------------------------------------------------
// Activity context (still needed for recent run details)
// ---------------------------------------------------------------------------

export interface ActivityContext {
  recentRuns: {
    date: string;
    type: string;
    distanceKm: number;
    durationMin: number;
    avgPaceSecsPerKm: number;
    avgHR?: number;
  }[];
  weeklyMileageKm: number;
  totalActivities: number;
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

export function buildPlanGenerationPrompt(opts: {
  input: PlanGenerationInput;
  periodization: PeriodizationPlan;
  paces: TrainingPaces;
  analysis?: AthleteAnalysis;
  activities?: ActivityContext;
  healthConstraints?: HealthConstraint[];
}): string {
  const { input, periodization, paces, analysis, activities, healthConstraints } = opts;
  const lines: string[] = [];

  // ── Goal section ──────────────────────────────────────────────────────
  lines.push("## Goal");
  lines.push(`- Type: ${input.goal.type}`);
  if (input.goal.raceName) lines.push(`- Race: ${input.goal.raceName}`);
  if (input.goal.raceDate) lines.push(`- Date: ${input.goal.raceDate}`);
  lines.push(`- Distance: ${(input.goal.targetDistanceMeters / 1000).toFixed(1)} km`);
  if (input.goal.targetTimeSeconds) {
    const h = Math.floor(input.goal.targetTimeSeconds / 3600);
    const m = Math.floor((input.goal.targetTimeSeconds % 3600) / 60);
    const s = input.goal.targetTimeSeconds % 60;
    const formatted = h > 0 ? `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}` : `${m}:${s.toString().padStart(2, "0")}`;
    lines.push(`- Target time: ${formatted}`);
  }
  lines.push(`- Weeks remaining: ${input.goal.weeksRemaining}`);
  lines.push("");

  // ── Schedule section ──────────────────────────────────────────────────
  lines.push("## Schedule");
  lines.push(`- Training days per week: ${input.schedule.daysPerWeek}`);
  lines.push(`- Preferred days: ${input.schedule.preferredDays.join(", ")}`);
  lines.push(`- Long run day: ${input.schedule.preferredLongRunDay}`);
  lines.push("");

  // ── Periodization ─────────────────────────────────────────────────────
  lines.push("## Periodization Plan");
  lines.push(`Total weeks: ${periodization.totalWeeks}`);
  for (const phase of periodization.phases) {
    lines.push(`- ${phase.phase}: weeks ${phase.startWeek}-${phase.endWeek} (${phase.weeks} weeks)`);
  }
  lines.push("");

  // ── Training paces ────────────────────────────────────────────────────
  lines.push("## Training Paces (use these for workout steps)");
  lines.push(`- Recovery: ${formatPace(paces.recovery.min)} to ${formatPace(paces.recovery.max)} (${paces.recovery.min}-${paces.recovery.max} sec/km)`);
  lines.push(`- Easy: ${formatPace(paces.easy.min)} to ${formatPace(paces.easy.max)} (${paces.easy.min}-${paces.easy.max} sec/km)`);
  lines.push(`- Marathon: ${formatPace(paces.marathon.min)} to ${formatPace(paces.marathon.max)} (${paces.marathon.min}-${paces.marathon.max} sec/km)`);
  lines.push(`- Threshold: ${formatPace(paces.threshold.min)} to ${formatPace(paces.threshold.max)} (${paces.threshold.min}-${paces.threshold.max} sec/km)`);
  lines.push(`- Interval: ${formatPace(paces.interval.min)} to ${formatPace(paces.interval.max)} (${paces.interval.min}-${paces.interval.max} sec/km)`);
  lines.push(`- Repetition: ${formatPace(paces.repetition.min)} to ${formatPace(paces.repetition.max)} (${paces.repetition.min}-${paces.repetition.max} sec/km)`);
  lines.push("");

  // ── Athlete analysis (derived metrics — replaces raw health data) ────
  if (analysis) {
    lines.push("## Athlete Analysis (pre-computed from Garmin data)");
    lines.push(formatAnalysisForPrompt(analysis));
    lines.push("");
  }

  // ── Recent activities (compact table format) ──────────────────────────
  if (activities && activities.recentRuns.length > 0) {
    lines.push("## Recent Runs");
    lines.push(`Weekly mileage: ~${activities.weeklyMileageKm.toFixed(1)} km | Total activities (30d): ${activities.totalActivities}`);
    lines.push("| Date | Distance | Duration | Pace | HR |");
    lines.push("|------|----------|----------|------|-----|");
    for (const run of activities.recentRuns.slice(0, 8)) {
      const pace = formatPace(run.avgPaceSecsPerKm);
      const hr = run.avgHR ? `${run.avgHR}` : "—";
      lines.push(`| ${run.date} | ${run.distanceKm.toFixed(1)}km | ${run.durationMin.toFixed(0)}min | ${pace} | ${hr} |`);
    }
    lines.push("");
  }

  // ── Exercise knowledge (injury-specific guidance from SSKG-inspired lookup) ──
  if (healthConstraints && healthConstraints.length > 0) {
    const constraintLabels = healthConstraints.map((c) => c.label);
    const relevantKnowledge = getRelevantKnowledge(constraintLabels);
    const knowledgeText = formatKnowledgeForPrompt(relevantKnowledge, constraintLabels);
    if (knowledgeText) {
      lines.push(knowledgeText);
      lines.push("");
    }
  }

  // ── Structured health constraints ─────────────────────────────────────
  if (healthConstraints && healthConstraints.length > 0) {
    const now = new Date().toISOString().slice(0, 10);
    const active = healthConstraints.filter((c) => {
      if (c.activeFrom && c.activeFrom > now) return false;
      if (c.activeUntil && c.activeUntil < now) return false;
      return true;
    });
    if (active.length > 0) {
      lines.push("## Health Constraints (MUST RESPECT)");
      for (const c of active) {
        const severity = c.severity === "avoid" ? "[AVOID]" : c.severity === "modify" ? "[MODIFY]" : "[MONITOR]";
        lines.push(`${severity} ${c.label} — Affects: ${c.affectedWorkoutTypes.join(", ")}`);
        if (c.notes) lines.push(`  → ${c.notes}`);
      }
      lines.push("");
      lines.push("IMPORTANT: For AVOID constraints, do not schedule the listed workout types. Substitute with easy_run or rest.");
      lines.push("For MODIFY constraints, reduce intensity/duration for the listed workout types.");
      lines.push("");
    }
  }

  // ── Free-text constraints (backward compat) ────────────────────────────
  if (input.constraints) {
    lines.push("## Additional User Notes");
    lines.push(input.constraints);
    lines.push("");
  }

  // ── Instructions ──────────────────────────────────────────────────────
  lines.push("## Instructions");
  lines.push(`Generate a complete ${periodization.totalWeeks}-week training plan for this runner.`);
  lines.push("Follow the periodization phases defined above.");
  lines.push(`Each week should have exactly ${input.schedule.daysPerWeek} training days plus ${7 - input.schedule.daysPerWeek} rest days, scheduled on the preferred days.`);
  lines.push("Use the training paces provided (in seconds per km) for all workout step targets.");
  lines.push("Include step-back weeks (reduced volume by 20-30%) every 3-4 weeks.");
  lines.push("Ensure 80/20 intensity distribution: ~80% easy volume, ~20% quality.");
  lines.push("Long run should be 25-35% of weekly mileage.");

  if (analysis) {
    lines.push("");
    lines.push("Use the athlete analysis above to calibrate the plan:");
    lines.push("- Respect the ACWR risk band when setting initial week intensity.");
    lines.push("- If recovery readiness is below 50, start the first week conservatively.");
    lines.push("- Consider pace efficiency trends when setting easy/threshold paces.");
  }

  return lines.join("\n");
}
