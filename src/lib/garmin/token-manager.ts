import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { garminConnections } from "@/lib/db/schema";
import { encrypt, decrypt } from "@/lib/utils/encryption";
import { refreshAccessToken, type GarminTokenResponse } from "./auth";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Proactively refresh tokens within 7 days of expiry */
const REFRESH_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface StoredTokens {
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
}

export interface GarminConnection {
  id: string;
  userId: string;
  garminUserId: string | null;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  connectedAt: Date;
  backfillStatus: string;
  backfillRequestedAt: Date | null;
  backfillCompletedAt: Date | null;
  lastSyncAt: Date | null;
}

// ─── Token Storage ──────────────────────────────────────────────────────────

/**
 * Store Garmin OAuth tokens (encrypted) in the garmin_connections table.
 * Creates a new connection record or updates an existing one.
 */
export async function storeTokens(
  userId: string,
  tokens: GarminTokenResponse,
  garminUserId?: string
): Promise<void> {
  const encryptedAccessToken = encrypt(tokens.access_token);
  const encryptedRefreshToken = encrypt(tokens.refresh_token);
  const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  // Check if a connection already exists for this user
  const existing = await db
    .select({ id: garminConnections.id })
    .from(garminConnections)
    .where(eq(garminConnections.userId, userId))
    .then((rows) => rows[0] ?? null);

  if (existing) {
    await db
      .update(garminConnections)
      .set({
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        tokenExpiresAt,
        ...(garminUserId ? { garminUserId } : {}),
      })
      .where(eq(garminConnections.userId, userId));
  } else {
    await db.insert(garminConnections).values({
      userId,
      garminUserId: garminUserId ?? null,
      accessToken: encryptedAccessToken,
      refreshToken: encryptedRefreshToken,
      tokenExpiresAt,
      connectedAt: new Date(),
      backfillStatus: "pending",
    });
  }
}

// ─── Token Retrieval ────────────────────────────────────────────────────────

/**
 * Retrieve and decrypt stored tokens for a user.
 * Returns null if no connection exists.
 */
export async function getStoredTokens(
  userId: string
): Promise<StoredTokens | null> {
  const connection = await db
    .select({
      accessToken: garminConnections.accessToken,
      refreshToken: garminConnections.refreshToken,
      tokenExpiresAt: garminConnections.tokenExpiresAt,
    })
    .from(garminConnections)
    .where(eq(garminConnections.userId, userId))
    .then((rows) => rows[0] ?? null);

  if (!connection) return null;

  return {
    accessToken: decrypt(connection.accessToken),
    refreshToken: connection.refreshToken ? decrypt(connection.refreshToken) : null,
    tokenExpiresAt: connection.tokenExpiresAt,
  };
}

// ─── Token Expiry Check ─────────────────────────────────────────────────────

/**
 * Check if a token is expired or will expire within the refresh threshold.
 */
export function isTokenExpiringSoon(expiresAt: Date | null): boolean {
  if (!expiresAt) return true;
  return Date.now() + REFRESH_THRESHOLD_MS >= expiresAt.getTime();
}

// ─── Get Valid Token (Auto-Refresh) ─────────────────────────────────────────

/**
 * Get a valid access token for a user, auto-refreshing if needed.
 * Returns the decrypted access token string, or null if no connection exists.
 *
 * If the token is expired or expiring soon and a refresh token is available,
 * the token is refreshed and the new tokens are stored.
 */
export async function getValidAccessToken(
  userId: string
): Promise<string | null> {
  const tokens = await getStoredTokens(userId);

  if (!tokens) return null;

  // If token is not expiring soon, return it directly
  if (!isTokenExpiringSoon(tokens.tokenExpiresAt)) {
    return tokens.accessToken;
  }

  // Token is expiring soon — attempt refresh
  if (!tokens.refreshToken) {
    // No refresh token available; return current token even if it may be stale
    return tokens.accessToken;
  }

  try {
    const newTokens = await refreshAccessToken(tokens.refreshToken);
    await storeTokens(userId, newTokens);
    return newTokens.access_token;
  } catch (error) {
    // If refresh fails, return the existing token (it might still work)
    console.error(
      `[token-manager] Failed to refresh token for user ${userId}:`,
      error
    );
    return tokens.accessToken;
  }
}

// ─── Connection Queries ─────────────────────────────────────────────────────

/**
 * Get the full Garmin connection record for a user.
 */
export async function getConnection(
  userId: string
): Promise<GarminConnection | null> {
  const connection = await db
    .select()
    .from(garminConnections)
    .where(eq(garminConnections.userId, userId))
    .then((rows) => rows[0] ?? null);

  return connection;
}

/**
 * Delete the Garmin connection for a user.
 */
export async function deleteConnection(userId: string): Promise<void> {
  await db
    .delete(garminConnections)
    .where(eq(garminConnections.userId, userId));
}

/**
 * Update the last_sync_at timestamp for a user's connection.
 */
export async function updateLastSync(userId: string): Promise<void> {
  await db
    .update(garminConnections)
    .set({ lastSyncAt: new Date() })
    .where(eq(garminConnections.userId, userId));
}

/**
 * Update the backfill status for a user's connection.
 */
export async function updateBackfillStatus(
  userId: string,
  status: "pending" | "in_progress" | "completed",
  completedAt?: Date
): Promise<void> {
  await db
    .update(garminConnections)
    .set({
      backfillStatus: status,
      ...(status === "in_progress"
        ? { backfillRequestedAt: new Date() }
        : {}),
      ...(completedAt ? { backfillCompletedAt: completedAt } : {}),
    })
    .where(eq(garminConnections.userId, userId));
}
