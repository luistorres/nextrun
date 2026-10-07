import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getBackfillProgress } from "@/lib/garmin/backfill-status";

/**
 * GET /api/garmin/backfill-status
 *
 * Returns detailed backfill progress for the authenticated user, including:
 * - Overall status (pending, in_progress, completed, failed)
 * - When the backfill was requested and completed
 * - Per-data-type breakdown (if available from in-memory tracking)
 * - Estimated completion time
 */
export async function GET() {
  // Require authentication
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const progress = await getBackfillProgress(session.user.id);

  if (!progress) {
    return NextResponse.json(
      {
        connected: false,
        backfill: null,
        message: "No Garmin connection found. Connect your Garmin account first.",
      },
      { status: 404 }
    );
  }

  return NextResponse.json({
    connected: true,
    backfill: {
      status: progress.overallStatus,
      requestedAt: progress.requestedAt,
      completedAt: progress.completedAt,
      estimatedCompletionAt: progress.estimatedCompletionAt,
      totalChunks: progress.totalChunks,
      completedChunks: progress.completedChunks,
      dataTypes: progress.dataTypes,
    },
  });
}
