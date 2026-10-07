import {
  pgTable,
  text,
  numeric,
  timestamp,
  uuid,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./auth";

// ─── Shoes ──────────────────────────────────────────────────────────────────
// Running shoe registry. Garmin's partner API does not expose gear, so
// activity↔shoe assignment is manual (PATCH /api/activities/[id]/shoe).
// Mileage is computed at read time (startingKm + assigned activity distance),
// never stored.

export const SHOE_CATEGORIES = [
  "daily_trainer",
  "super_shoe",
  "racing_flat",
  "trail",
  "stability",
  "other",
] as const;

export type ShoeCategory = (typeof SHOE_CATEGORIES)[number];

export const shoes = pgTable(
  "shoes",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    brand: text("brand"),
    model: text("model"),
    category: text("category").$type<ShoeCategory>().notNull(),
    /** Pre-existing mileage (km) before the shoe was registered here. */
    startingKm: numeric("starting_km").notNull().default("0"),
    /** Set when the shoe is retired; retired shoes keep their history. */
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userIdIdx: index("shoes_user_id_idx").on(table.userId),
  })
);
