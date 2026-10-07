/**
 * Manually trigger an adaptation for the active plan.
 * Usage: npx tsx scripts/trigger-adaptation.ts
 */

import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";
import { adaptPlan } from "../src/lib/plan-engine/adapter";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!);
  const db = drizzle(sql, { schema });

  // Find the active plan
  const [plan] = await db
    .select({
      id: schema.trainingPlans.id,
      userId: schema.trainingPlans.userId,
      planVersion: schema.trainingPlans.planVersion,
    })
    .from(schema.trainingPlans)
    .where(eq(schema.trainingPlans.status, "active"))
    .limit(1);

  if (!plan) {
    console.error("No active plan found");
    process.exit(1);
  }

  // Clean up existing adaptations for this plan
  const deleted = await db
    .delete(schema.adaptations)
    .where(eq(schema.adaptations.planId, plan.id))
    .returning({ id: schema.adaptations.id });

  console.log(`Cleaned up ${deleted.length} existing adaptation(s) for plan ${plan.id}`);

  console.log(`Triggering adaptation for plan ${plan.id} (v${plan.planVersion}), user ${plan.userId}`);

  const result = await adaptPlan(db, plan.userId, plan.id, {
    trigger: "weekly_review",
  });

  if (result.adapted) {
    console.log("\nAdaptation generated:");
    console.log(`  ID: ${result.adaptationId}`);
    console.log(`  Severity: ${result.severity}`);
    console.log(`  Changes: ${result.changes.length}`);
    console.log(`  Explanation: ${result.explanation}`);
    result.changes.forEach((c, i) => {
      console.log(`  [${i + 1}] ${c.change}: ${c.reason}`);
    });
  } else {
    console.log(`\nNo adaptation needed: ${result.explanation}`);
  }

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
