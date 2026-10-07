import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { userPreferences } from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const patchSchema = z.object({
  units: z.enum(["metric", "imperial"]).optional(),
  paceDisplay: z.enum(["min_km", "min_mi"]).optional(),
  weekStartDay: z.enum(["monday", "sunday"]).optional(),
  theme: z.enum(["dark", "light", "system"]).optional(),
  emailNotifications: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// GET /api/settings/preferences — Return user preferences (upsert defaults)
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const prefs = await getOrCreatePreferences(session.user.id);
    return NextResponse.json({ preferences: prefs });
  } catch (error) {
    console.error("Get preferences error:", error);
    return NextResponse.json(
      { error: "Failed to fetch preferences" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/settings/preferences — Update preferences
// ---------------------------------------------------------------------------

export async function PATCH(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const result = patchSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error.issues[0].message },
        { status: 400 },
      );
    }

    // Ensure preferences row exists
    await getOrCreatePreferences(session.user.id);

    const updated = await db
      .update(userPreferences)
      .set({ ...result.data, updatedAt: new Date() })
      .where(eq(userPreferences.userId, session.user.id))
      .returning();

    return NextResponse.json({ preferences: updated[0] });
  } catch (error) {
    console.error("Update preferences error:", error);
    return NextResponse.json(
      { error: "Failed to update preferences" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getOrCreatePreferences(userId: string) {
  const [prefs] = await db
    .insert(userPreferences)
    .values({ userId })
    .onConflictDoNothing({ target: userPreferences.userId })
    .returning();

  if (prefs) return prefs;

  return db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .then((res) => res[0]);
}
