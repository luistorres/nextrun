import { describe, it, expect } from "vitest";
import { formatFeedbackForPrompt } from "../feedback-context";
import type { FeedbackSentiment, FeedbackType, PainArea } from "@/lib/db/schema/training";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFeedback(overrides: Partial<{
  id: string;
  sentiment: FeedbackSentiment | null;
  reasonForMiss: string | null;
  contextualNotes: string | null;
  painAreas: PainArea[] | null;
  externalStressors: string[] | null;
  feedbackType: FeedbackType;
  createdAt: Date;
}> = {}) {
  return {
    id: "fb-1",
    sentiment: null,
    reasonForMiss: null,
    contextualNotes: null,
    painAreas: null,
    externalStressors: null,
    feedbackType: "general" as FeedbackType,
    createdAt: new Date("2026-03-25T10:00:00Z"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("formatFeedbackForPrompt", () => {
  it("returns undefined for empty feedback array", () => {
    expect(formatFeedbackForPrompt([])).toBeUndefined();
  });

  it("formats a basic daily check-in with sentiment", () => {
    const result = formatFeedbackForPrompt([
      makeFeedback({
        sentiment: "feeling_tired",
        feedbackType: "daily_checkin",
      }),
    ]);

    expect(result).toBeDefined();
    expect(result).toContain("2026-03-25");
    expect(result).toContain("Daily check-in");
    expect(result).toContain("Feeling tired");
  });

  it("formats contextual notes", () => {
    const result = formatFeedbackForPrompt([
      makeFeedback({
        contextualNotes: "Leg felt heavy today",
        feedbackType: "post_workout",
      }),
    ]);

    expect(result).toContain('Notes: "Leg felt heavy today"');
    expect(result).toContain("Post-workout");
  });

  it("formats reason for miss", () => {
    const result = formatFeedbackForPrompt([
      makeFeedback({
        reasonForMiss: "Had to work late",
        feedbackType: "skip_reason",
      }),
    ]);

    expect(result).toContain('Reason for miss: "Had to work late"');
    expect(result).toContain("Skip reason");
  });

  it("formats pain areas with severity", () => {
    const result = formatFeedbackForPrompt([
      makeFeedback({
        painAreas: [
          { area: "Knees", severity: "moderate" },
          { area: "Shins", severity: "mild" },
        ],
      }),
    ]);

    expect(result).toContain("Pain: Knees (moderate), Shins (mild)");
  });

  it("formats external stressors", () => {
    const result = formatFeedbackForPrompt([
      makeFeedback({
        externalStressors: ["Work stress", "Poor sleep"],
      }),
    ]);

    expect(result).toContain("Stressors: Work stress, Poor sleep");
  });

  it("formats multiple feedback entries with all fields", () => {
    const result = formatFeedbackForPrompt([
      makeFeedback({
        id: "fb-1",
        sentiment: "feeling_great",
        contextualNotes: "Best run in weeks",
        feedbackType: "post_workout",
        createdAt: new Date("2026-03-25T10:00:00Z"),
      }),
      makeFeedback({
        id: "fb-2",
        sentiment: "feeling_okay",
        painAreas: [{ area: "Back", severity: "mild" }],
        externalStressors: ["Travel"],
        feedbackType: "daily_checkin",
        createdAt: new Date("2026-03-24T08:00:00Z"),
      }),
    ]);

    expect(result).toBeDefined();
    const lines = result!.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("Feeling great");
    expect(lines[0]).toContain("Best run in weeks");
    expect(lines[1]).toContain("Feeling okay");
    expect(lines[1]).toContain("Pain: Back (mild)");
    expect(lines[1]).toContain("Stressors: Travel");
  });

  it("handles feedback with only sentiment (no extra fields)", () => {
    const result = formatFeedbackForPrompt([
      makeFeedback({
        sentiment: "feeling_good",
        feedbackType: "daily_checkin",
      }),
    ]);

    expect(result).toBeDefined();
    expect(result).toContain("Mood: Feeling good");
    expect(result).not.toContain("Pain:");
    expect(result).not.toContain("Stressors:");
    expect(result).not.toContain("Notes:");
  });
});
