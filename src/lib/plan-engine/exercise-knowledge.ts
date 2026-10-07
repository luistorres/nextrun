/**
 * Static exercise-constraint knowledge base (simplified SSKG).
 *
 * Inspired by the Sports Science Knowledge Graph (SSKG) from He et al. (2026),
 * which encodes 10K+ expert triples including contraindications.
 * Our simplified version covers running-specific exercises and cross-training
 * relevant to common injury presentations, using curated expert knowledge.
 *
 * No DB, no async — pure static data for prompt injection.
 *
 * Reference: He, Wang, Zhang & Li (2026), "Knowledge-Grounded LLM for
 * Personalized Sports Training Plan Generation," Scientific Reports.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExerciseKnowledgeEntry {
  /** Workout type this entry describes */
  workoutType: string;
  /** Injury/condition categories that contraindicate this workout */
  contraindicatedBy: string[];
  /** Modifications for specific conditions (condition → modification instruction) */
  modifications: Record<string, string>;
  /** Safe alternative workout types when this exercise is contraindicated */
  alternatives: string[];
}

// ---------------------------------------------------------------------------
// Knowledge base
// ---------------------------------------------------------------------------

const EXERCISE_KNOWLEDGE: ExerciseKnowledgeEntry[] = [
  {
    workoutType: "hill_repeats",
    contraindicatedBy: [
      "achilles tendinopathy",
      "plantar fasciitis",
      "patellofemoral pain",
      "calf strain",
    ],
    modifications: {
      "knee pain": "Reduce grade to <3%, shorten repeats to 30s, focus on low cadence",
      "calf tightness": "Replace uphill with flat strides; avoid heel-striking on incline",
    },
    alternatives: ["strides", "fartlek", "easy_run"],
  },
  {
    workoutType: "intervals",
    contraindicatedBy: [
      "it band syndrome",
      "stress fracture",
      "shin splints",
      "hamstring strain",
    ],
    modifications: {
      "mild shin splints": "Use pool running or elliptical for interval effort; reduce impact",
      "early it band": "Shorten intervals to 400m max; avoid banked track",
    },
    alternatives: ["tempo", "fartlek", "easy_run"],
  },
  {
    workoutType: "tempo",
    contraindicatedBy: [
      "stress fracture",
      "severe plantar fasciitis",
    ],
    modifications: {
      "mild plantar fasciitis": "Shorten to 15 min max; run on soft surface; stop if pain >3/10",
    },
    alternatives: ["easy_run", "cross_training"],
  },
  {
    workoutType: "long_run",
    contraindicatedBy: [
      "stress fracture",
      "severe achilles tendinopathy",
    ],
    modifications: {
      "mild achilles": "Cap at 90 min; avoid downhill sections; monitor next-day stiffness",
      "it band syndrome": "Break into 2 shorter runs with 4h rest between; avoid cambered roads",
    },
    alternatives: ["cross_training"],
  },
  {
    workoutType: "race_pace",
    contraindicatedBy: [
      "stress fracture",
      "acute hamstring strain",
    ],
    modifications: {
      "patellofemoral pain": "Reduce to marathon pace + 15 sec/km; avoid sustained downhill",
    },
    alternatives: ["easy_run", "tempo"],
  },
  {
    workoutType: "cross_training",
    contraindicatedBy: [],
    modifications: {
      "patellofemoral pain": "Use low resistance cycling only; avoid deep knee flexion (>90°)",
      "lower back pain": "Prefer swimming or aqua jogging over cycling",
    },
    alternatives: [],
  },
  {
    workoutType: "fartlek",
    contraindicatedBy: [
      "stress fracture",
      "acute injury",
    ],
    modifications: {
      "shin splints": "Replace surges with rolling easy-moderate effort; avoid sprint sections",
    },
    alternatives: ["easy_run", "recovery"],
  },
];

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * Return knowledge entries relevant to the given constraint labels.
 * Matches constraint label (lowercase) against contraindicatedBy strings.
 */
export function getRelevantKnowledge(
  constraintLabels: string[],
): ExerciseKnowledgeEntry[] {
  if (constraintLabels.length === 0) return [];

  const lowerLabels = constraintLabels.map((l) => l.toLowerCase());

  return EXERCISE_KNOWLEDGE.filter((entry) =>
    entry.contraindicatedBy.some((condition) =>
      lowerLabels.some((label) => label.includes(condition) || condition.includes(label)),
    ),
  );
}

/**
 * Format relevant knowledge entries into a prompt-injectable text block.
 *
 * Example output:
 * ```
 * ## Exercise Knowledge (injury-specific guidance)
 * hill_repeats: Contraindicated by achilles tendinopathy.
 *   Alternative: strides, fartlek, easy_run
 * ```
 */
export function formatKnowledgeForPrompt(
  entries: ExerciseKnowledgeEntry[],
  constraintLabels: string[],
): string {
  if (entries.length === 0) return "";

  const lowerLabels = constraintLabels.map((l) => l.toLowerCase());
  const lines: string[] = ["## Exercise Knowledge (injury-specific guidance)"];

  for (const entry of entries) {
    const relevantContraindications = entry.contraindicatedBy.filter((c) =>
      lowerLabels.some((label) => label.includes(c) || c.includes(label)),
    );

    if (relevantContraindications.length === 0) continue;

    lines.push(`${entry.workoutType}: Contraindicated by ${relevantContraindications.join(", ")}.`);

    // Relevant modifications
    for (const [condition, mod] of Object.entries(entry.modifications)) {
      if (lowerLabels.some((label) => label.includes(condition) || condition.includes(label))) {
        lines.push(`  Modification (${condition}): ${mod}`);
      }
    }

    if (entry.alternatives.length > 0) {
      lines.push(`  Safe alternatives: ${entry.alternatives.join(", ")}`);
    }
  }

  return lines.join("\n");
}
