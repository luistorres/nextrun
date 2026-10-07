import { format } from "date-fns";
import type { FeedbackSentiment, FeedbackType, PainArea } from "@/lib/db/schema/training";

// ---------------------------------------------------------------------------
// Types (matches the workoutFeedback select shape)
// ---------------------------------------------------------------------------

interface FeedbackRow {
  id: string;
  sentiment: FeedbackSentiment | null;
  reasonForMiss: string | null;
  contextualNotes: string | null;
  painAreas: PainArea[] | null;
  externalStressors: string[] | null;
  feedbackType: FeedbackType;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Sentiment labels (human-readable for the AI prompt)
// ---------------------------------------------------------------------------

const SENTIMENT_LABELS: Record<FeedbackSentiment, string> = {
  feeling_great: "Feeling great",
  feeling_good: "Feeling good",
  feeling_okay: "Feeling okay",
  feeling_tired: "Feeling tired",
  feeling_terrible: "Feeling terrible",
};

const FEEDBACK_TYPE_LABELS: Record<FeedbackType, string> = {
  post_workout: "Post-workout",
  skip_reason: "Skip reason",
  daily_checkin: "Daily check-in",
  general: "General",
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function formatFeedbackForPrompt(
  feedback: FeedbackRow[],
): string | undefined {
  if (feedback.length === 0) return undefined;

  const lines: string[] = [];

  for (const entry of feedback) {
    const parts: string[] = [];

    const dateStr = format(new Date(entry.createdAt), "yyyy-MM-dd");
    parts.push(`[${dateStr}] (${FEEDBACK_TYPE_LABELS[entry.feedbackType]})`);

    if (entry.sentiment) {
      parts.push(`Mood: ${SENTIMENT_LABELS[entry.sentiment]}`);
    }

    if (entry.contextualNotes) {
      parts.push(`Notes: "${entry.contextualNotes}"`);
    }

    if (entry.reasonForMiss) {
      parts.push(`Reason for miss: "${entry.reasonForMiss}"`);
    }

    if (entry.painAreas && entry.painAreas.length > 0) {
      const painStr = entry.painAreas
        .map((p) => `${p.area} (${p.severity})`)
        .join(", ");
      parts.push(`Pain: ${painStr}`);
    }

    if (entry.externalStressors && entry.externalStressors.length > 0) {
      parts.push(`Stressors: ${entry.externalStressors.join(", ")}`);
    }

    lines.push(`- ${parts.join(" | ")}`);
  }

  return lines.join("\n");
}
