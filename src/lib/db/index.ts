import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL!;

const client = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(client, { schema });

export type Database = typeof db;

/**
 * A type that accepts both the full database instance and a transaction.
 * Use this for functions that need to work inside db.transaction() callbacks.
 */
export type DatabaseOrTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];
