import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getConnection } from "@/lib/garmin/token-manager";

/**
 * GET /api/garmin/sync-status
 *
 * Returns the user's Garmin connection status, including:
 * - Whether they are connected
 * - When they connected
 * - Last sync time
 * - Backfill status and timestamps
 */
export async function GET() {
  // Require authentication
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const connection = await getConnection(session.user.id);

  if (!connection) {
    return NextResponse.json({
      connected: false,
      garminUserId: null,
      connectedAt: null,
      lastSyncAt: null,
      backfillStatus: null,
      backfillRequestedAt: null,
      backfillCompletedAt: null,
    });
  }

  return NextResponse.json({
    connected: true,
    garminUserId: connection.garminUserId,
    connectedAt: connection.connectedAt.toISOString(),
    lastSyncAt: connection.lastSyncAt?.toISOString() ?? null,
    backfillStatus: connection.backfillStatus,
    backfillRequestedAt:
      connection.backfillRequestedAt?.toISOString() ?? null,
    backfillCompletedAt:
      connection.backfillCompletedAt?.toISOString() ?? null,
  });
}
