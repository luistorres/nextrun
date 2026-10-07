import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../src/lib/db/schema";

/**
 * Separate Drizzle database client for the worker process.
 *
 * This is intentionally a standalone instance (not shared with the Next.js app)
 * because workers run in their own Node.js process.
 */
const connectionString = process.env.DATABASE_URL!;

const client = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(client, { schema });

export type Database = typeof db;
