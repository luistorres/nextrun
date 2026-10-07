import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const patchSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name is too long"),
});

// ---------------------------------------------------------------------------
// GET /api/settings/profile — Return user profile
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, session.user.id))
      .then((res) => res[0] ?? null);

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ profile: user });
  } catch (error) {
    console.error("Get profile error:", error);
    return NextResponse.json(
      { error: "Failed to fetch profile" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/settings/profile — Update profile (name only)
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

    const updated = await db
      .update(users)
      .set({ name: result.data.name, updatedAt: new Date() })
      .where(eq(users.id, session.user.id))
      .returning({ id: users.id, name: users.name, email: users.email });

    return NextResponse.json({ profile: updated[0] });
  } catch (error) {
    console.error("Update profile error:", error);
    return NextResponse.json(
      { error: "Failed to update profile" },
      { status: 500 },
    );
  }
}
