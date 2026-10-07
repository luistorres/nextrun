import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

// One row per sendMessage() call: token usage, latency, API-call outcome
// (success covers the call, not downstream validation). Source for per-user
// cost accounting. Deliberately never stores prompt or response bodies.

export const aiCalls = pgTable(
  "ai_calls",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: text("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    callsite: text("callsite").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens"),
    cacheWriteTokens: integer("cache_write_tokens"),
    latencyMs: integer("latency_ms").notNull(),
    success: boolean("success").notNull(),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userCreatedIdx: index("ai_calls_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
  }),
);
