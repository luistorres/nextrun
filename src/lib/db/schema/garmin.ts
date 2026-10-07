import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./auth";

// ─── Garmin Connections ─────────────────────────────────────────────────────
// Stores each user's Garmin OAuth tokens and sync state.
// One connection per user; tokens are stored encrypted at the application layer.

export const garminConnections = pgTable(
  "garmin_connections",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    garminUserId: text("garmin_user_id").unique(),
    accessToken: text("access_token").notNull(),
    accessTokenSecret: text("access_token_secret"),
    refreshToken: text("refresh_token"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    connectedAt: timestamp("connected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    backfillStatus: text("backfill_status").notNull().default("pending"),
    backfillRequestedAt: timestamp("backfill_requested_at", {
      withTimezone: true,
    }),
    backfillCompletedAt: timestamp("backfill_completed_at", {
      withTimezone: true,
    }),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  },
  (table) => ({
    userIdIdx: uniqueIndex("garmin_connections_user_id_idx").on(table.userId),
    garminUserIdIdx: uniqueIndex("garmin_connections_garmin_user_id_idx").on(
      table.garminUserId
    ),
  })
);

// ─── Garmin File Events ─────────────────────────────────────────────────────
// Durable ledger for Garmin Activity File ping notifications (FIT/TCX/GPX).
// Garmin does NOT retry failed pings and the callbackURL is only valid for
// ~24 hours (a successful download followed by a re-download returns 410),
// so every ping is recorded here first and the actual download happens
// asynchronously via the fit-download queue with aggressive retries.
//
// Status lifecycle:
//   received → enqueued → downloaded
//                       ↘ failed_terminal (expired / 410 / unrecoverable)

export const garminFileEvents = pgTable(
  "garmin_file_events",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    summaryId: text("summary_id").notNull(),
    garminActivityId: text("garmin_activity_id"),
    fileType: text("file_type").notNull(),
    callbackUrl: text("callback_url").notNull(),
    status: text("status").notNull().default("received"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    /** Storage key/path once the file is durably stored (see src/lib/storage). */
    storedPath: text("stored_path"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    downloadedAt: timestamp("downloaded_at", { withTimezone: true }),
    /** Garmin callback URLs expire ~24h after the ping (receivedAt + 24h). */
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '24 hours'`),
  },
  (table) => ({
    userSummaryIdx: uniqueIndex("garmin_file_events_user_summary_idx").on(
      table.userId,
      table.summaryId
    ),
  })
);
