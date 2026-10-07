import { randomBytes, createHash } from "crypto";

// ─── Garmin OAuth 2.0 Endpoints ─────────────────────────────────────────────

const GARMIN_AUTH_BASE = "https://apis.garmin.com/oauth2";

export const GARMIN_ENDPOINTS = {
  authorization: `${GARMIN_AUTH_BASE}/authorize`,
  token: `${GARMIN_AUTH_BASE}/token`,
  revoke: `${GARMIN_AUTH_BASE}/revoke`,
  userRegistration: "https://apis.garmin.com/wellness-api/rest/user/registration",
} as const;

// Scopes for Health API (read health data) and Training API (push workouts)
export const GARMIN_SCOPES = [
  "health_read",
  "activity_read",
  "training_write",
  "training_read",
] as const;

// ─── Environment Configuration ──────────────────────────────────────────────

function getGarminConfig() {
  const clientId = process.env.GARMIN_CLIENT_ID;
  const clientSecret = process.env.GARMIN_CLIENT_SECRET;
  const redirectUri = process.env.GARMIN_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Missing Garmin OAuth environment variables: GARMIN_CLIENT_ID, GARMIN_CLIENT_SECRET, GARMIN_REDIRECT_URI"
    );
  }

  return { clientId, clientSecret, redirectUri };
}

// ─── PKCE Utilities ─────────────────────────────────────────────────────────

/**
 * Generate a cryptographically random code_verifier for PKCE.
 * Length is 64 characters, using URL-safe base64 encoding.
 */
export function generateCodeVerifier(): string {
  // 48 random bytes → 64 base64url characters
  return randomBytes(48)
    .toString("base64url")
    .slice(0, 64);
}

/**
 * Generate the S256 code_challenge from a code_verifier.
 * SHA-256 hash, base64url-encoded (no padding).
 */
export function generateCodeChallenge(codeVerifier: string): string {
  return createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
}

// ─── Authorization URL ──────────────────────────────────────────────────────

export interface AuthorizationUrlParams {
  codeChallenge: string;
  state: string;
}

/**
 * Build the Garmin OAuth 2.0 authorization URL with PKCE challenge.
 */
export function buildAuthorizationUrl({
  codeChallenge,
  state,
}: AuthorizationUrlParams): string {
  const { clientId, redirectUri } = getGarminConfig();

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GARMIN_SCOPES.join(" "),
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
  });

  return `${GARMIN_ENDPOINTS.authorization}?${params.toString()}`;
}

// ─── Token Exchange ─────────────────────────────────────────────────────────

export interface GarminTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

/**
 * Exchange an authorization code for access and refresh tokens.
 */
export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string
): Promise<GarminTokenResponse> {
  const { clientId, clientSecret, redirectUri } = getGarminConfig();

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
    code_verifier: codeVerifier,
  });

  const response = await fetch(GARMIN_ENDPOINTS.token, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Garmin token exchange failed (${response.status}): ${errorBody}`
    );
  }

  return response.json() as Promise<GarminTokenResponse>;
}

// ─── Token Refresh ──────────────────────────────────────────────────────────

/**
 * Refresh an access token using a refresh token.
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<GarminTokenResponse> {
  const { clientId, clientSecret } = getGarminConfig();

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(GARMIN_ENDPOINTS.token, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Garmin token refresh failed (${response.status}): ${errorBody}`
    );
  }

  return response.json() as Promise<GarminTokenResponse>;
}

// ─── Token Revocation ───────────────────────────────────────────────────────

/**
 * Revoke an access token with Garmin.
 */
export async function revokeToken(accessToken: string): Promise<void> {
  const { clientId, clientSecret } = getGarminConfig();

  const body = new URLSearchParams({
    token: accessToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(GARMIN_ENDPOINTS.revoke, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  // Revocation endpoints typically return 200 even if the token was already invalid.
  // Only throw on unexpected server errors.
  if (!response.ok && response.status >= 500) {
    const errorBody = await response.text();
    throw new Error(
      `Garmin token revocation failed (${response.status}): ${errorBody}`
    );
  }
}

// ─── User Registration (webhook registration) ──────────────────────────────

/**
 * Register a user with Garmin's webhook system after successful OAuth.
 * This tells Garmin to start pushing data to our webhook endpoints.
 */
export async function registerUserForWebhooks(
  accessToken: string
): Promise<void> {
  const response = await fetch(GARMIN_ENDPOINTS.userRegistration, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Garmin user registration failed (${response.status}): ${errorBody}`
    );
  }
}
