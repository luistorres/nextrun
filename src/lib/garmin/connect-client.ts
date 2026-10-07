/**
 * Wrapper around the unofficial `garmin-connect` npm package.
 *
 * Authenticates with Garmin Connect using username/password (same flow as the
 * Garmin Connect mobile app). Persists OAuth tokens in the garmin_connections
 * table so subsequent requests don't require re-login.
 */

import { GarminConnect } from "garmin-connect";
import type { IOauth1Token, IOauth2Token } from "garmin-connect/dist/garmin/types";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { garminConnections } from "@/lib/db/schema";
import { encrypt, decrypt } from "@/lib/utils/encryption";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface StoredTokens {
  oauth1: IOauth1Token;
  oauth2: IOauth2Token;
}

/**
 * Authenticate against Garmin Connect with username/password. No DB access —
 * never logs or stores the password. Throws on bad credentials or MFA.
 */
export async function authenticateGarmin(
  email: string,
  password: string,
): Promise<{ displayName: string; tokens: StoredTokens }> {
  const client = new GarminConnect({
    username: email,
    password,
  });

  await client.login();

  const { oauth1, oauth2 } = client.exportToken();

  // Get user profile for display name (needed for some API endpoints)
  const profile = await client.getUserProfile();
  const displayName = profile?.displayName ?? email;

  return { displayName, tokens: { oauth1, oauth2 } };
}

export async function persistGarminConnection(
  userId: string,
  displayName: string,
  tokens: StoredTokens,
): Promise<void> {
  const encryptedTokens = encrypt(JSON.stringify(tokens));

  // The same Garmin account may have been connected to a different app user
  // (garmin_user_id is unique); the latest login claims it.
  await db
    .delete(garminConnections)
    .where(
      and(
        eq(garminConnections.garminUserId, displayName),
        ne(garminConnections.userId, userId),
      ),
    );

  // On conflict, don't reset backfillStatus — a re-login must not re-trigger
  // the backfill flow for an already-imported account.
  await db
    .insert(garminConnections)
    .values({
      userId,
      garminUserId: displayName,
      accessToken: encryptedTokens,
      backfillStatus: "pending",
      connectedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: garminConnections.userId,
      set: {
        garminUserId: displayName,
        accessToken: encryptedTokens,
        connectedAt: new Date(),
      },
    });
}

export async function loginWithCredentials(
  userId: string,
  email: string,
  password: string,
): Promise<{ displayName: string }> {
  const { displayName, tokens } = await authenticateGarmin(email, password);
  await persistGarminConnection(userId, displayName, tokens);
  return { displayName };
}

/**
 * Create an authenticated GarminConnect client using stored tokens.
 * Returns null if no connection exists or tokens are invalid.
 */
export async function getAuthenticatedClient(
  userId: string,
): Promise<GarminConnect | null> {
  const [connection] = await db
    .select()
    .from(garminConnections)
    .where(eq(garminConnections.userId, userId))
    .limit(1);

  if (!connection) return null;

  let tokenData: StoredTokens;
  try {
    tokenData = JSON.parse(decrypt(connection.accessToken)) as StoredTokens;
  } catch {
    console.error("[garmin-connect] Failed to decrypt stored tokens");
    return null;
  }

  const client = new GarminConnect({
    username: "",
    password: "",
  });

  // Restore tokens — no re-login needed
  client.loadToken(tokenData.oauth1, tokenData.oauth2);

  return client;
}

/**
 * Update stored tokens after a successful API call (tokens may have been
 * refreshed automatically by the garmin-connect library).
 */
export async function persistTokens(
  userId: string,
  client: GarminConnect,
): Promise<void> {
  const { oauth1, oauth2 } = client.exportToken();
  const tokenData: StoredTokens = { oauth1, oauth2 };

  await db
    .update(garminConnections)
    .set({
      accessToken: encrypt(JSON.stringify(tokenData)),
      lastSyncAt: new Date(),
    })
    .where(eq(garminConnections.userId, userId));
}

/**
 * Remove the Garmin connection for a user.
 */
export async function disconnectGarmin(userId: string): Promise<void> {
  await db
    .delete(garminConnections)
    .where(eq(garminConnections.userId, userId));
}
