/**
 * AI output parser and validator.
 *
 * Uses Zod to validate Claude's structured output against the
 * PlanGenerationOutput type. Handles common AI formatting issues.
 */

import { z } from "zod/v4";
import type { AdaptationOutput, PlanGenerationOutput } from "@/types/plan";

// ---------------------------------------------------------------------------
// Zod schemas matching the types in src/types/plan.ts
// ---------------------------------------------------------------------------

const stepDurationTypeSchema = z.enum(["time", "distance", "open"]);
const stepTargetTypeSchema = z.enum(["pace", "heart_rate", "open"]);

const simpleWorkoutStepSchema = z.object({
  order: z.number(),
  type: z.enum(["warmup", "cooldown", "steady"]),
  durationType: stepDurationTypeSchema,
  durationValue: z.number().optional(),
  targetType: stepTargetTypeSchema,
  targetMin: z.number().optional(),
  targetMax: z.number().optional(),
  description: z.string().optional(),
});

const intervalWorkoutStepSchema = z.object({
  order: z.number(),
  type: z.literal("interval"),
  repeatCount: z.number(),
  workStep: z.object({
    durationType: stepDurationTypeSchema,
    durationValue: z.number().optional(),
    targetType: stepTargetTypeSchema,
    targetMin: z.number().optional(),
    targetMax: z.number().optional(),
  }),
  restStep: z.object({
    durationType: stepDurationTypeSchema,
    durationValue: z.number().optional(),
    targetType: stepTargetTypeSchema,
  }),
  description: z.string().optional(),
});

const workoutStepSchema = z.union([
  intervalWorkoutStepSchema,
  simpleWorkoutStepSchema,
]);

const workoutTypeSchema = z.enum([
  "easy_run",
  "long_run",
  "tempo",
  "intervals",
  "recovery",
  "fartlek",
  "hill_repeats",
  "race_pace",
  "rest",
  "cross_training",
]);

const planPhaseSchema = z.enum(["base", "build", "peak", "taper", "race_week"]);

export const generatedWorkoutSchema = z.object({
  day: z.string(),
  type: workoutTypeSchema,
  title: z.string(),
  description: z.string(),
  targetDistanceMeters: z.number().optional(),
  targetDurationSeconds: z.number().optional(),
  steps: z.array(workoutStepSchema),
});

const generatedWeekSchema = z.object({
  weekNumber: z.number(),
  phase: planPhaseSchema,
  weeklyMileageTargetKm: z.number(),
  explanation: z.string().optional(),
  workouts: z.array(generatedWorkoutSchema),
});

const phaseBoundarySchema = z.object({
  phase: planPhaseSchema,
  startWeek: z.number(),
  endWeek: z.number(),
});

export const planGenerationOutputSchema = z.object({
  totalWeeks: z.number(),
  phases: z.array(phaseBoundarySchema),
  weeks: z.array(generatedWeekSchema),
});

const adaptationChangeSchema = z.object({
  workoutId: z.string(),
  change: z.enum(["replaced", "modified", "added", "removed", "rescheduled"]),
  from: z.string().optional(),
  to: z.string().optional(),
  reason: z.string(),
});

export const adaptationOutputSchema = z.object({
  needed: z.boolean(),
  explanation: z.object({
    summary: z.string(),
    context: z.string(),
    keyPoints: z.array(z.string()),
    outlook: z.string().optional(),
  }),
  changes: z.array(adaptationChangeSchema),
  updatedWorkouts: z.array(generatedWorkoutSchema).optional(),
});

export function parseAdaptationOutput(raw: unknown): AdaptationOutput | null {
  const result = adaptationOutputSchema.safeParse(raw);
  if (!result.success) {
    console.warn(
      "[output-parser] adaptation output failed validation:",
      result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    );
    return null;
  }
  return result.data as AdaptationOutput;
}

// ---------------------------------------------------------------------------
// JSON cleaning utilities
// ---------------------------------------------------------------------------

/**
 * Strip markdown code blocks and fix common JSON issues from AI output.
 */
function cleanJsonString(raw: string): string {
  let cleaned = raw.trim();

  // Remove markdown code fences
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3);
  }

  cleaned = cleaned.trim();

  // Remove trailing commas before } or ]
  cleaned = cleaned.replace(/,\s*([\]}])/g, "$1");

  return cleaned;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse and validate AI-generated plan output.
 *
 * Accepts either:
 * 1. A pre-parsed object (from Claude tool_use)
 * 2. A raw JSON string (with optional markdown wrapping)
 *
 * Returns a typed PlanGenerationOutput or throws with a clear error.
 */
export function parsePlanOutput(
  raw: unknown,
): PlanGenerationOutput {
  let data: unknown;

  if (typeof raw === "string") {
    const cleaned = cleanJsonString(raw);
    try {
      data = JSON.parse(cleaned);
    } catch (e) {
      throw new Error(
        `Failed to parse AI output as JSON: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  } else {
    data = raw;
  }

  const result = planGenerationOutputSchema.safeParse(data);

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `AI output validation failed:\n${issues}`,
    );
  }

  return result.data as PlanGenerationOutput;
}

// ---------------------------------------------------------------------------
// JSON Schema for structured outputs (output_config.format)
// ---------------------------------------------------------------------------

const STEP_DURATION_TYPE = {
  type: "string",
  enum: ["time", "distance", "open"],
} as const;

const STEP_TARGET_TYPE = {
  type: "string",
  enum: ["pace", "heart_rate", "open"],
} as const;

export const SIMPLE_STEP_SCHEMA = {
  type: "object",
  required: ["order", "type", "durationType", "targetType"],
  additionalProperties: false,
  properties: {
    order: { type: "number" },
    type: { type: "string", enum: ["warmup", "cooldown", "steady"] },
    durationType: {
      ...STEP_DURATION_TYPE,
      description: "How the step duration is measured",
    },
    durationValue: {
      type: "number",
      description: "Duration value — seconds for time, meters for distance",
    },
    targetType: STEP_TARGET_TYPE,
    targetMin: {
      type: "number",
      description: "Min target value (faster pace in sec/km, or lower HR)",
    },
    targetMax: {
      type: "number",
      description: "Max target value (slower pace in sec/km, or upper HR)",
    },
    description: { type: "string" },
  },
} as const;

export const INTERVAL_STEP_SCHEMA = {
  type: "object",
  required: ["order", "type", "repeatCount", "workStep", "restStep"],
  additionalProperties: false,
  properties: {
    order: { type: "number" },
    type: { type: "string", enum: ["interval"] },
    repeatCount: {
      type: "number",
      description: "Number of work/rest repetitions",
    },
    workStep: {
      type: "object",
      description: "The work portion of each repetition",
      required: ["durationType", "targetType"],
      additionalProperties: false,
      properties: {
        durationType: STEP_DURATION_TYPE,
        durationValue: { type: "number" },
        targetType: STEP_TARGET_TYPE,
        targetMin: { type: "number" },
        targetMax: { type: "number" },
      },
    },
    restStep: {
      type: "object",
      description: "The recovery portion of each repetition",
      required: ["durationType", "targetType"],
      additionalProperties: false,
      properties: {
        durationType: STEP_DURATION_TYPE,
        durationValue: { type: "number" },
        targetType: STEP_TARGET_TYPE,
      },
    },
    description: { type: "string" },
  },
} as const;

/**
 * JSON Schema for plan generation via structured outputs
 * (output_config.format). Guarantees schema-valid JSON from the model;
 * parsePlanOutput still applies Zod domain validation on top.
 */
export function getPlanGenerationOutputSchema(): Record<string, unknown> {
  return {
    type: "object",
    required: ["totalWeeks", "phases", "weeks"],
    additionalProperties: false,
    properties: {
      totalWeeks: {
        type: "number",
        description: "Total number of weeks in the plan",
      },
      phases: {
        type: "array",
        description: "Phase boundaries",
        items: {
          type: "object",
          required: ["phase", "startWeek", "endWeek"],
          additionalProperties: false,
          properties: {
            phase: {
              type: "string",
              enum: ["base", "build", "peak", "taper", "race_week"],
            },
            startWeek: { type: "number" },
            endWeek: { type: "number" },
          },
        },
      },
      weeks: {
        type: "array",
        description: "All weeks of the plan",
        items: {
          type: "object",
          required: ["weekNumber", "phase", "weeklyMileageTargetKm", "workouts"],
          additionalProperties: false,
          properties: {
            weekNumber: { type: "number" },
            phase: {
              type: "string",
              enum: ["base", "build", "peak", "taper", "race_week"],
            },
            weeklyMileageTargetKm: { type: "number" },
            explanation: { type: "string" },
            workouts: {
              type: "array",
              items: {
                type: "object",
                required: ["day", "type", "title", "description", "steps"],
                additionalProperties: false,
                properties: {
                  day: {
                    type: "string",
                    description: "Day of the week (monday, tuesday, etc.)",
                  },
                  type: {
                    type: "string",
                    enum: [
                      "easy_run", "long_run", "tempo", "intervals",
                      "recovery", "fartlek", "hill_repeats", "race_pace",
                      "rest", "cross_training",
                    ],
                  },
                  title: { type: "string" },
                  description: { type: "string" },
                  targetDistanceMeters: { type: "number" },
                  targetDurationSeconds: { type: "number" },
                  steps: {
                    type: "array",
                    description:
                      "Garmin-compatible workout steps. Each step is either a simple step (warmup/cooldown/steady) or an interval step.",
                    items: {
                      anyOf: [SIMPLE_STEP_SCHEMA, INTERVAL_STEP_SCHEMA],
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}
