import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  primaryKey,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
// ─── Users ──────────────────────────────────────────────────────────────────
// Auth.js required fields: id, name, email, emailVerified, image
// Custom fields: onboardingCompleted, subscriptionStatus

export const users = pgTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),

  // Custom fields
  onboardingCompleted: boolean("onboarding_completed")
    .notNull()
    .default(false),
  subscriptionStatus: text("subscription_status").notNull().default("free"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const allowedEmails = pgTable("allowed_emails", {
  // stored lowercase; sign-in normalizes before lookup
  email: text("email").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const waitlist = pgTable("waitlist", {
  // stored lowercase; must match the Garmin account email to be allowlisted
  email: text("email").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Accounts ───────────────────────────────────────────────────────────────
// OAuth provider accounts (Garmin will be added in Unit 04)

export const accounts = pgTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<"email" | "oidc" | "oauth" | "webauthn">().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => ({
    compositePk: primaryKey({
      columns: [account.provider, account.providerAccountId],
    }),
  })
);

// ─── Sessions ───────────────────────────────────────────────────────────────
// Database sessions — required by the Drizzle adapter even when using JWT strategy

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

// ─── Verification Tokens ────────────────────────────────────────────────────
// For email verification flows

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (verificationToken) => ({
    compositePk: primaryKey({
      columns: [verificationToken.identifier, verificationToken.token],
    }),
  })
);

// ─── User Preferences ──────────────────────────────────────────────────────
// Per-user display and notification preferences.

export const userPreferences = pgTable("user_preferences", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" })
    .unique(),
  units: text("units").$type<"metric" | "imperial">().notNull().default("metric"),
  paceDisplay: text("pace_display").$type<"min_km" | "min_mi">().notNull().default("min_km"),
  weekStartDay: text("week_start_day").$type<"monday" | "sunday">().notNull().default("monday"),
  theme: text("theme").$type<"dark" | "light" | "system">().notNull().default("dark"),
  emailNotifications: boolean("email_notifications").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
