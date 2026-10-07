import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { garminFileEvents } from "@/lib/db/schema";

// ─── Garmin File Event Ledger ───────────────────────────────────────────────
// Every Activity File ping is recorded here before anything else happens —
// Garmin never retries pings and callback URLs die after ~24h, so the ledger
// is the source of truth for what still needs downloading.

/** Garmin callback URLs are valid for ~24 hours after the ping. */
const CALLBACK_TTL_MS = 24 * 60 * 60 * 1000;

export interface FileEventInput {
  userId: string;
  summaryId: string;
  garminActivityId: string | null;
  fileType: string;
  callbackUrl: string;
}

/**
 * Upsert a ledger row for an incoming file ping (unique on userId+summaryId).
 *
 * - New ping → insert with status "received".
 * - Re-ping for a row we already downloaded → keep it untouched.
 * - Re-ping for a pending/failed row → reset it (fresh callback URL means a
 *   fresh 24h window and a clean retry budget).
 */
export async function upsertFileEvent(data: FileEventInput) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CALLBACK_TTL_MS);

  const [existing] = await db
    .select()
    .from(garminFileEvents)
    .where(
      and(
        eq(garminFileEvents.userId, data.userId),
        eq(garminFileEvents.summaryId, data.summaryId),
      ),
    )
    .limit(1);

  if (existing) {
    if (existing.status === "downloaded") {
      return existing;
    }

    const [updated] = await db
      .update(garminFileEvents)
      .set({
        garminActivityId: data.garminActivityId,
        fileType: data.fileType,
        callbackUrl: data.callbackUrl,
        status: "received",
        attempts: 0,
        lastError: null,
        receivedAt: now,
        expiresAt,
      })
      .where(eq(garminFileEvents.id, existing.id))
      .returning();
    return updated;
  }

  const [inserted] = await db
    .insert(garminFileEvents)
    .values({
      ...data,
      status: "received",
      receivedAt: now,
      expiresAt,
    })
    // Concurrent pings for the same summary can race past the select above;
    // the unique index wins and we fall back to the existing row.
    .onConflictDoNothing()
    .returning();

  if (inserted) return inserted;

  const [raced] = await db
    .select()
    .from(garminFileEvents)
    .where(
      and(
        eq(garminFileEvents.userId, data.userId),
        eq(garminFileEvents.summaryId, data.summaryId),
      ),
    )
    .limit(1);
  return raced;
}

/** Mark a ledger row as enqueued (only forward from "received"). */
export async function markFileEventEnqueued(id: string): Promise<void> {
  await db
    .update(garminFileEvents)
    .set({ status: "enqueued" })
    .where(
      and(eq(garminFileEvents.id, id), eq(garminFileEvents.status, "received")),
    );
}
