import { NextResponse } from "next/server";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { activities, shoes, SHOE_CATEGORIES } from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const patchSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100).optional(),
  brand: z.string().trim().max(100).nullish(),
  model: z.string().trim().max(100).nullish(),
  category: z.enum(SHOE_CATEGORIES).optional(),
  startingKm: z.number().min(0).max(5000).optional(),
  /** true → retire (sets retiredAt), false → reactivate (clears it) */
  retired: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function findOwnedShoe(shoeId: string, userId: string) {
  const [shoe] = await db
    .select()
    .from(shoes)
    .where(and(eq(shoes.id, shoeId), eq(shoes.userId, userId)))
    .limit(1);
  return shoe ?? null;
}

// ---------------------------------------------------------------------------
// PATCH /api/shoes/[id] — Edit or retire/reactivate a shoe
// ---------------------------------------------------------------------------

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const result = patchSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error.issues[0].message },
        { status: 400 },
      );
    }

    const shoe = await findOwnedShoe(id, session.user.id);
    if (!shoe) {
      return NextResponse.json({ error: "Shoe not found" }, { status: 404 });
    }

    const { name, brand, model, category, startingKm, retired } = result.data;

    const [updated] = await db
      .update(shoes)
      .set({
        ...(name !== undefined && { name }),
        ...(brand !== undefined && { brand: brand || null }),
        ...(model !== undefined && { model: model || null }),
        ...(category !== undefined && { category }),
        ...(startingKm !== undefined && { startingKm: String(startingKm) }),
        ...(retired !== undefined && {
          retiredAt: retired ? (shoe.retiredAt ?? new Date()) : null,
        }),
      })
      .where(eq(shoes.id, id))
      .returning();

    return NextResponse.json({
      shoe: {
        id: updated.id,
        name: updated.name,
        brand: updated.brand,
        model: updated.model,
        category: updated.category,
        startingKm: Number(updated.startingKm),
        retiredAt: updated.retiredAt?.toISOString() ?? null,
        createdAt: updated.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("Update shoe error:", error);
    return NextResponse.json(
      { error: "Failed to update shoe" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/shoes/[id] — Delete a shoe (only when no activities assigned)
// ---------------------------------------------------------------------------

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const shoe = await findOwnedShoe(id, session.user.id);
    if (!shoe) {
      return NextResponse.json({ error: "Shoe not found" }, { status: 404 });
    }

    const [{ assigned }] = await db
      .select({ assigned: count(activities.id) })
      .from(activities)
      .where(eq(activities.shoeId, id));

    if (assigned > 0) {
      return NextResponse.json(
        {
          error:
            "Shoe has activities assigned. Retire it instead to keep its history.",
        },
        { status: 409 },
      );
    }

    await db.delete(shoes).where(eq(shoes.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete shoe error:", error);
    return NextResponse.json(
      { error: "Failed to delete shoe" },
      { status: 500 },
    );
  }
}
