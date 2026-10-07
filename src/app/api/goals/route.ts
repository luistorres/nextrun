import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { z } from "zod/v4";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { userGoals } from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const healthConstraintSchema = z.object({
  id: z.string(),
  category: z.enum(["injury", "chronic_condition", "equipment", "lifestyle"]),
  label: z.string(),
  affectedWorkoutTypes: z.array(z.string()),
  severity: z.enum(["avoid", "modify", "monitor"]),
  notes: z.string().optional(),
  activeFrom: z.string().optional(),
  activeUntil: z.string().optional(),
});

const createGoalSchema = z.object({
  goalType: z.enum(["race", "general_fitness", "distance_milestone"]),
  raceName: z.string().optional(),
  raceDate: z.string().optional(),
  targetDistanceMeters: z.number().min(1000),
  targetTimeSeconds: z.number().min(60).optional(),
  trainingDaysPerWeek: z.number().min(3).max(7),
  preferredTrainingDays: z.array(z.string()).min(3).max(7),
  preferredLongRunDay: z.string(),
  constraints: z.string().optional(),
  healthConstraints: z.array(healthConstraintSchema).optional(),
});

// ---------------------------------------------------------------------------
// POST /api/goals — Create a new training goal
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const result = createGoalSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error.issues[0].message },
        { status: 400 },
      );
    }

    const data = result.data;

    // Create the goal
    const [goal] = await db
      .insert(userGoals)
      .values({
        userId: session.user.id,
        goalType: data.goalType,
        raceName: data.raceName ?? null,
        raceDate: data.raceDate ?? null,
        targetDistanceMeters: data.targetDistanceMeters,
        targetTimeSeconds: data.targetTimeSeconds ?? null,
        trainingDaysPerWeek: data.trainingDaysPerWeek,
        preferredTrainingDays: data.preferredTrainingDays,
        preferredLongRunDay: data.preferredLongRunDay,
        constraints: data.constraints ?? null,
        healthConstraints: data.healthConstraints ?? [],
        status: "active",
      })
      .returning();

    return NextResponse.json({ goal }, { status: 201 });
  } catch (error) {
    console.error("Create goal error:", error);
    return NextResponse.json(
      { error: "Failed to create goal" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// GET /api/goals — Get user's goals
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const goals = await db
      .select()
      .from(userGoals)
      .where(eq(userGoals.userId, session.user.id))
      .orderBy(desc(userGoals.createdAt));

    return NextResponse.json({ goals });
  } catch (error) {
    console.error("Get goals error:", error);
    return NextResponse.json(
      { error: "Failed to fetch goals" },
      { status: 500 },
    );
  }
}
