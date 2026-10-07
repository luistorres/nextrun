import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { coachMessages } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

// ---------------------------------------------------------------------------
// GET /api/coach/history — Fetch recent coach chat messages
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const messages = await db
      .select({
        id: coachMessages.id,
        role: coachMessages.role,
        content: coachMessages.content,
        createdAt: coachMessages.createdAt,
      })
      .from(coachMessages)
      .where(eq(coachMessages.userId, session.user.id))
      .orderBy(desc(coachMessages.createdAt))
      .limit(50);

    // Reverse to chronological order for the client
    messages.reverse();

    return NextResponse.json({
      messages: messages.map((m) => ({
        ...m,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("[coach/history] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch coach history" },
      { status: 500 },
    );
  }
}
