import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { activities, shoes } from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const patchSchema = z.object({
  /** Shoe to assign, or null to clear the assignment */
  shoeId: z.uuid().nullable(),
});

// ---------------------------------------------------------------------------
// PATCH /api/activities/[id]/shoe — Manually assign a shoe to an activity
// ---------------------------------------------------------------------------
// Garmin's partner API does not expose gear, so assignment is always an
// explicit user action — there is no silent default-shoe auto-assignment.

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: activityId } = await params;
    const body = await request.json();
    const result = patchSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error.issues[0].message },
        { status: 400 },
      );
    }

    const { shoeId } = result.data;

    // Verify activity ownership
    const [activity] = await db
      .select({ id: activities.id })
      .from(activities)
      .where(
        and(
          eq(activities.id, activityId),
          eq(activities.userId, session.user.id),
        ),
      )
      .limit(1);

    if (!activity) {
      return NextResponse.json(
        { error: "Activity not found" },
        { status: 404 },
      );
    }

    // Verify shoe ownership when assigning
    if (shoeId !== null) {
      const [shoe] = await db
        .select({ id: shoes.id })
        .from(shoes)
        .where(and(eq(shoes.id, shoeId), eq(shoes.userId, session.user.id)))
        .limit(1);

      if (!shoe) {
        return NextResponse.json({ error: "Shoe not found" }, { status: 404 });
      }
    }

    const [updated] = await db
      .update(activities)
      .set({ shoeId })
      .where(eq(activities.id, activityId))
      .returning({ id: activities.id, shoeId: activities.shoeId });

    return NextResponse.json({ activity: updated });
  } catch (error) {
    console.error("Assign shoe error:", error);
    return NextResponse.json(
      { error: "Failed to assign shoe" },
      { status: 500 },
    );
  }
}
