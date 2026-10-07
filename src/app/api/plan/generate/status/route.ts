import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { userGoals } from "@/lib/db/schema";
import { planGenerationQueue } from "@/lib/queue/queues";
import { mapJobState } from "@/lib/queue/job-status";

const querySchema = z.object({ goalId: z.uuid().optional() });

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    goalId: searchParams.get("goalId") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid goalId" }, { status: 400 });
  }

  let goalId = parsed.data.goalId;
  if (!goalId) {
    const [latest] = await db
      .select({ id: userGoals.id })
      .from(userGoals)
      .where(eq(userGoals.userId, session.user.id))
      .orderBy(desc(userGoals.createdAt))
      .limit(1);
    if (!latest) return NextResponse.json({ status: "not_found" });
    goalId = latest.id;
  }

  try {
    const job = await planGenerationQueue.getJob(
      `plan-gen-${session.user.id}-${goalId}`,
    );
    if (!job) {
      return NextResponse.json({ status: "not_found" });
    }
    const status = mapJobState(await job.getState());
    return NextResponse.json({
      status,
      ...(status === "failed"
        ? { error: job.failedReason ?? "Plan generation failed" }
        : {}),
    });
  } catch {
    // A Redis blip must read as still-working, never as failure.
    return NextResponse.json({ status: "queued" });
  }
}
