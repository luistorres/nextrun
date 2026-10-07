/**
 * POST /api/garmin/connect-login
 *
 * Authenticates with Garmin Connect using username/password (unofficial API).
 * This bypasses the official OAuth flow — no developer credentials needed.
 *
 * Body: { email: string, password: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { loginWithCredentials } from "@/lib/garmin/connect-client";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { email, password } = body;
  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required" },
      { status: 400 },
    );
  }

  try {
    const { displayName } = await loginWithCredentials(
      session.user.id,
      email,
      password,
    );

    return NextResponse.json({
      success: true,
      displayName,
      message: "Garmin account connected successfully",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    // Drizzle errors embed query params, which here include raw OAuth tokens —
    // never log the full error object.
    console.error(
      `[garmin/connect-login] Login failed: ${message.split("\n")[0]}`,
    );

    // Check for common failure modes
    if (message.includes("MFA") || message.includes("Ticket not found")) {
      return NextResponse.json(
        {
          error:
            "Login failed. If you have MFA/2FA enabled on your Garmin account, please disable it temporarily and try again.",
        },
        { status: 401 },
      );
    }

    return NextResponse.json(
      { error: "Failed to connect to Garmin. Please check your credentials." },
      { status: 401 },
    );
  }
}
