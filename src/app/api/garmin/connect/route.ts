import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { auth } from "@/auth";
import {
  generateCodeVerifier,
  generateCodeChallenge,
  buildAuthorizationUrl,
} from "@/lib/garmin/auth";

/**
 * GET /api/garmin/connect
 *
 * Initiates the Garmin OAuth 2.0 + PKCE flow.
 * 1. Generates a PKCE code_verifier and code_challenge
 * 2. Generates a random state parameter for CSRF protection
 * 3. Stores code_verifier and state in HTTP-only cookies
 * 4. Redirects the user to Garmin's authorization page
 */
export async function GET() {
  // Require authentication
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Generate PKCE values
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  // Generate state parameter for CSRF protection
  const state = randomBytes(32).toString("base64url");

  // Build the authorization URL
  const authorizationUrl = buildAuthorizationUrl({
    codeChallenge,
    state,
  });

  // Create the redirect response
  const response = NextResponse.redirect(authorizationUrl);

  // Store code_verifier in an HTTP-only cookie for the callback to retrieve.
  // Max age set to 10 minutes — more than enough for the OAuth flow.
  response.cookies.set("garmin_code_verifier", codeVerifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 minutes
  });

  // Store state in an HTTP-only cookie for CSRF validation in the callback
  response.cookies.set("garmin_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  return response;
}
