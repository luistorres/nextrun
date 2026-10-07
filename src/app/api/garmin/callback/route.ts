import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  exchangeCodeForTokens,
  registerUserForWebhooks,
} from "@/lib/garmin/auth";
import { storeTokens, updateBackfillStatus } from "@/lib/garmin/token-manager";
import { enqueueBackfill } from "@/lib/queue/producer";
import { format, subMonths } from "date-fns";

/**
 * GET /api/garmin/callback
 *
 * Handles the OAuth 2.0 callback from Garmin after user authorization.
 * 1. Validates the state parameter (CSRF protection)
 * 2. Extracts the authorization code from query params
 * 3. Retrieves the code_verifier from the cookie
 * 4. Exchanges the code for tokens
 * 5. Encrypts and stores tokens in the database
 * 6. Registers the user for Garmin webhooks
 * 7. Enqueues a backfill job for historical data
 * 8. Redirects to the dashboard
 */
export async function GET(request: NextRequest) {
  // Require authentication
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(
      new URL("/login?error=unauthorized", request.url)
    );
  }

  const userId = session.user.id;
  const searchParams = request.nextUrl.searchParams;

  // Extract query parameters
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  // Handle errors from Garmin (user denied access, etc.)
  if (error) {
    console.error(`[garmin/callback] OAuth error: ${error}`);
    return NextResponse.redirect(
      new URL(
        `/dashboard/settings?garmin_error=${encodeURIComponent(error)}`,
        request.url
      )
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL(
        "/dashboard/settings?garmin_error=missing_code",
        request.url
      )
    );
  }

  // Validate state parameter (CSRF protection)
  const storedState = request.cookies.get("garmin_oauth_state")?.value;
  if (!state || !storedState || state !== storedState) {
    console.error("[garmin/callback] State mismatch — possible CSRF attack");
    return NextResponse.redirect(
      new URL(
        "/dashboard/settings?garmin_error=invalid_state",
        request.url
      )
    );
  }

  // Retrieve the code_verifier from the cookie
  const codeVerifier = request.cookies.get("garmin_code_verifier")?.value;
  if (!codeVerifier) {
    console.error("[garmin/callback] Missing code_verifier cookie");
    return NextResponse.redirect(
      new URL(
        "/dashboard/settings?garmin_error=missing_verifier",
        request.url
      )
    );
  }

  try {
    // Exchange the authorization code for tokens
    const tokens = await exchangeCodeForTokens(code, codeVerifier);

    // Store encrypted tokens in the database
    // Note: garminUserId may be available in the token response or a subsequent API call.
    // For now, we store without it and it can be updated when we receive webhook data.
    await storeTokens(userId, tokens);

    // Register the user for Garmin webhook push notifications
    try {
      await registerUserForWebhooks(tokens.access_token);
    } catch (webhookError) {
      // Webhook registration failure is non-fatal — we can retry later
      console.error(
        "[garmin/callback] Webhook registration failed (non-fatal):",
        webhookError
      );
    }

    // Enqueue backfill jobs for historical data (last 6 months, in monthly chunks)
    const now = new Date();
    const monthsToBackfill = 6;

    for (let i = 0; i < monthsToBackfill; i++) {
      const chunkEnd = subMonths(now, i);
      const chunkStart = subMonths(now, i + 1);

      await enqueueBackfill({
        userId,
        startDate: format(chunkStart, "yyyy-MM-dd"),
        endDate: format(chunkEnd, "yyyy-MM-dd"),
        chunkIndex: i,
      });
    }

    // Mark backfill as in_progress
    await updateBackfillStatus(userId, "in_progress");

    // Build redirect response and clear the OAuth cookies
    const redirectUrl = new URL(
      "/dashboard?garmin_connected=true",
      request.url
    );
    const response = NextResponse.redirect(redirectUrl);

    response.cookies.delete("garmin_code_verifier");
    response.cookies.delete("garmin_oauth_state");

    return response;
  } catch (err) {
    console.error("[garmin/callback] Token exchange failed:", err);
    const redirectUrl = new URL(
      "/dashboard/settings?garmin_error=token_exchange_failed",
      request.url
    );
    const response = NextResponse.redirect(redirectUrl);

    // Clean up cookies even on failure
    response.cookies.delete("garmin_code_verifier");
    response.cookies.delete("garmin_oauth_state");

    return response;
  }
}
