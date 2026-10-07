import { eq, and, between, asc, desc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  trainingPlans,
  plannedWorkouts,
  userGoals,
  adaptations,
} from "@/lib/db/schema";

// ─── Active Plan with Workouts ──────────────────────────────────────────────

export async function getActivePlanWithWorkouts(userId: string) {
  const result = await db.query.trainingPlans.findFirst({
    where: and(
      eq(trainingPlans.userId, userId),
      eq(trainingPlans.status, "active")
    ),
    with: {
      goal: true,
      workouts: {
        orderBy: [asc(plannedWorkouts.scheduledDate), asc(plannedWorkouts.sortOrder)],
      },
    },
  });
  return result ?? null;
}

// ─── Get Workouts by Week ───────────────────────────────────────────────────
// Returns planned workouts for a given date range (typically Monday-Sunday).

export async function getWorkoutsByWeek(
  planId: string,
  weekStartDate: string,
  weekEndDate: string
) {
  return db
    .select()
    .from(plannedWorkouts)
    .where(
      and(
        eq(plannedWorkouts.planId, planId),
        between(plannedWorkouts.scheduledDate, weekStartDate, weekEndDate)
      )
    )
    .orderBy(asc(plannedWorkouts.scheduledDate), asc(plannedWorkouts.sortOrder));
}

// ─── Update Workout Status ──────────────────────────────────────────────────

export async function updateWorkoutStatus(
  workoutId: string,
  completionStatus: string,
  completedActivityId?: string
) {
  const [result] = await db
    .update(plannedWorkouts)
    .set({
      completionStatus,
      completedActivityId,
    })
    .where(eq(plannedWorkouts.id, workoutId))
    .returning();
  return result;
}

// ─── Update Workout Sync Status ─────────────────────────────────────────────

export async function updateWorkoutSyncStatus(
  workoutId: string,
  syncStatus: string,
  garminWorkoutId?: string
) {
  const [result] = await db
    .update(plannedWorkouts)
    .set({
      syncStatus,
      garminWorkoutId: garminWorkoutId ?? undefined,
    })
    .where(eq(plannedWorkouts.id, workoutId))
    .returning();
  return result;
}

// ─── Get Active Goal ────────────────────────────────────────────────────────

export async function getActiveGoal(userId: string) {
  const [result] = await db
    .select()
    .from(userGoals)
    .where(
      and(eq(userGoals.userId, userId), eq(userGoals.status, "active"))
    )
    .orderBy(desc(userGoals.createdAt))
    .limit(1);
  return result ?? null;
}

// ─── Create Training Plan ───────────────────────────────────────────────────

export async function createTrainingPlan(
  data: typeof trainingPlans.$inferInsert
) {
  const [result] = await db.insert(trainingPlans).values(data).returning();
  return result;
}

// ─── Create Planned Workouts (batch) ────────────────────────────────────────

export async function createPlannedWorkouts(
  data: (typeof plannedWorkouts.$inferInsert)[]
) {
  if (data.length === 0) return [];
  return db.insert(plannedWorkouts).values(data).returning();
}

// ─── Supersede Plan ─────────────────────────────────────────────────────────
// Marks the current active plan as superseded when an adaptation generates
// a new plan version.

export async function supersedePlan(planId: string) {
  const [result] = await db
    .update(trainingPlans)
    .set({ status: "superseded" })
    .where(eq(trainingPlans.id, planId))
    .returning();
  return result;
}

// ─── Create Adaptation Record ───────────────────────────────────────────────

export async function createAdaptation(
  data: typeof adaptations.$inferInsert
) {
  const [result] = await db.insert(adaptations).values(data).returning();
  return result;
}

// ─── Get Adaptation History ─────────────────────────────────────────────────

export async function getAdaptationHistory(planId: string) {
  return db
    .select()
    .from(adaptations)
    .where(eq(adaptations.planId, planId))
    .orderBy(desc(adaptations.createdAt));
}

// ─── Get Pending Workouts ───────────────────────────────────────────────────
// Workouts scheduled for today or later that haven't been completed.

export async function getPendingWorkouts(planId: string) {
  const today = new Date().toISOString().split("T")[0];
  return db
    .select()
    .from(plannedWorkouts)
    .where(
      and(
        eq(plannedWorkouts.planId, planId),
        eq(plannedWorkouts.completionStatus, "pending"),
        sql`${plannedWorkouts.scheduledDate} >= ${today}`
      )
    )
    .orderBy(asc(plannedWorkouts.scheduledDate), asc(plannedWorkouts.sortOrder));
}

// ─── Get Next Sort Order ───────────────────────────────────────────────────
// Returns the next available sortOrder for a given plan and date.

export async function getNextSortOrder(planId: string, date: string): Promise<number> {
  const [result] = await db
    .select({ maxOrder: sql<number>`coalesce(max(${plannedWorkouts.sortOrder}), -1)` })
    .from(plannedWorkouts)
    .where(
      and(
        eq(plannedWorkouts.planId, planId),
        eq(plannedWorkouts.scheduledDate, date),
      )
    );
  return (result?.maxOrder ?? -1) + 1;
}
