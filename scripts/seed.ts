/**
 * Database seed script.
 * Creates a test user with 30 days of health data, 10 activities,
 * a user goal, a training plan, and 7 planned workouts for the current week.
 *
 * Usage: pnpm db:seed
 */

import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/lib/db/schema";

const SEED_EMAIL = "test@garmincoach.dev";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

const client = postgres(connectionString, { max: 1 });
const db = drizzle(client, { schema });

// ─── Helpers ────────────────────────────────────────────────────────────────

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

function dateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min: number, max: number, decimals = 1): string {
  return (Math.random() * (max - min) + min).toFixed(decimals);
}

/** Get the Monday of the current week */
function getCurrentWeekMonday(): Date {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Sunday
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function addDays(d: Date, n: number): Date {
  const result = new Date(d);
  result.setDate(result.getDate() + n);
  return result;
}

const DAYS_OF_WEEK = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

// ─── Seed ───────────────────────────────────────────────────────────────────

async function seed() {
  console.log("Seeding database...");

  // 1. Create test user
  await db
    .insert(schema.allowedEmails)
    .values({ email: SEED_EMAIL })
    .onConflictDoNothing();

  const [testUser] = await db
    .insert(schema.users)
    .values({
      id: crypto.randomUUID(),
      name: "Test Runner",
      email: SEED_EMAIL,
      onboardingCompleted: true,
      subscriptionStatus: "active",
    })
    .onConflictDoNothing()
    .returning();

  if (!testUser) {
    console.log("Test user already exists, fetching...");
    const existing = await db.query.users.findFirst({
      where: (u, { eq }) => eq(u.email, SEED_EMAIL),
    });
    if (!existing) {
      throw new Error("Failed to create or find test user");
    }
    console.log(`Using existing user: ${existing.id}`);
    await seedData(existing.id);
    return;
  }

  console.log(`Created test user: ${testUser.id}`);
  await seedData(testUser.id);
}

async function seedData(userId: string) {
  // 2. Create Garmin connection
  await db
    .insert(schema.garminConnections)
    .values({
      userId,
      garminUserId: "garmin-test-user-12345",
      accessToken: "encrypted_test_access_token",
      accessTokenSecret: "encrypted_test_token_secret",
      backfillStatus: "completed",
      backfillRequestedAt: daysAgo(30),
      backfillCompletedAt: daysAgo(29),
      lastSyncAt: new Date(),
    })
    .onConflictDoNothing();

  console.log("Created Garmin connection");

  // 3. Seed 30 days of daily summaries
  const dailySummaryValues = Array.from({ length: 30 }, (_, i) => {
    const date = daysAgo(29 - i);
    const isRestDay = i % 7 === 6; // Every 7th day
    return {
      userId,
      calendarDate: dateStr(date),
      steps: isRestDay ? randomBetween(3000, 6000) : randomBetween(7000, 14000),
      distanceMeters: isRestDay
        ? randomFloat(2000, 5000, 0)
        : randomFloat(5000, 15000, 0),
      activeSeconds: isRestDay
        ? randomBetween(1200, 3600)
        : randomBetween(3600, 7200),
      restingHeartRate: randomBetween(48, 56),
      minHeartRate: randomBetween(42, 50),
      maxHeartRate: randomBetween(150, 185),
      averageStressLevel: randomBetween(20, 45),
      bodyBatteryStart: randomBetween(60, 100),
      bodyBatteryEnd: randomBetween(15, 50),
      vo2Max: randomFloat(48, 52),
      respirationAvg: randomFloat(14, 17),
      rawJson: null,
    };
  });

  await db
    .insert(schema.dailySummaries)
    .values(dailySummaryValues)
    .onConflictDoNothing();
  console.log("Seeded 30 daily summaries");

  // 4. Seed 30 sleep records
  const sleepValues = Array.from({ length: 30 }, (_, i) => {
    const date = daysAgo(29 - i);
    const totalSleep = randomBetween(21600, 30600); // 6h - 8.5h
    const deepPct = 0.15 + Math.random() * 0.1;
    const remPct = 0.2 + Math.random() * 0.05;
    const lightPct = 0.5 + Math.random() * 0.1;
    const awakePct = 1 - deepPct - remPct - lightPct;

    const bedtime = new Date(date);
    bedtime.setHours(22, randomBetween(0, 59), 0, 0);
    const wakeTime = new Date(bedtime.getTime() + totalSleep * 1000);

    return {
      userId,
      calendarDate: dateStr(date),
      totalSleepSeconds: totalSleep,
      deepSleepSeconds: Math.round(totalSleep * deepPct),
      lightSleepSeconds: Math.round(totalSleep * lightPct),
      remSleepSeconds: Math.round(totalSleep * remPct),
      awakeSeconds: Math.round(totalSleep * awakePct),
      sleepScore: randomBetween(60, 92),
      startTime: bedtime,
      endTime: wakeTime,
      rawJson: null,
    };
  });

  await db
    .insert(schema.sleepRecords)
    .values(sleepValues)
    .onConflictDoNothing();
  console.log("Seeded 30 sleep records");

  // 5. Seed 30 HRV records
  const hrvValues = Array.from({ length: 30 }, (_, i) => {
    const date = daysAgo(29 - i);
    const weeklyAvg = randomFloat(45, 65);
    const lastNight = randomFloat(35, 75);
    const status =
      parseFloat(lastNight) < 40
        ? "low"
        : parseFloat(lastNight) > 60
          ? "high"
          : "balanced";

    return {
      userId,
      calendarDate: dateStr(date),
      hrvWeeklyAvg: weeklyAvg,
      hrvLastNight: lastNight,
      hrvStatus: status,
      rawJson: null,
    };
  });

  await db.insert(schema.hrvRecords).values(hrvValues).onConflictDoNothing();
  console.log("Seeded 30 HRV records");

  // 6. Seed 30 stress records
  const stressValues = Array.from({ length: 30 }, (_, i) => {
    const date = daysAgo(29 - i);
    const avgStress = randomBetween(20, 45);
    return {
      userId,
      calendarDate: dateStr(date),
      stressValues: null,
      avgStress,
      maxStress: avgStress + randomBetween(15, 40),
      restStressDurationSeconds: randomBetween(14400, 28800),
      activityStressDurationSeconds: randomBetween(3600, 10800),
      highStressDurationSeconds: randomBetween(1800, 7200),
      rawJson: null,
    };
  });

  await db
    .insert(schema.stressRecords)
    .values(stressValues)
    .onConflictDoNothing();
  console.log("Seeded 30 stress records");

  // 7. Seed 10 activities (runs of various types)
  const runTypes: {
    type: string;
    label: string;
    distanceMin: number;
    distanceMax: number;
    paceMin: number;
    paceMax: number;
  }[] = [
    { type: "run", label: "Easy Run", distanceMin: 5000, distanceMax: 8000, paceMin: 330, paceMax: 370 },
    { type: "run", label: "Long Run", distanceMin: 14000, distanceMax: 18000, paceMin: 340, paceMax: 380 },
    { type: "run", label: "Tempo Run", distanceMin: 6000, distanceMax: 10000, paceMin: 290, paceMax: 320 },
    { type: "run", label: "Intervals", distanceMin: 6000, distanceMax: 9000, paceMin: 270, paceMax: 310 },
    { type: "run", label: "Recovery Run", distanceMin: 4000, distanceMax: 6000, paceMin: 360, paceMax: 400 },
    { type: "run", label: "Easy Run", distanceMin: 5000, distanceMax: 8000, paceMin: 330, paceMax: 370 },
    { type: "run", label: "Hill Repeats", distanceMin: 7000, distanceMax: 9000, paceMin: 300, paceMax: 340 },
    { type: "run", label: "Easy Run", distanceMin: 5000, distanceMax: 8000, paceMin: 330, paceMax: 370 },
    { type: "run", label: "Long Run", distanceMin: 16000, distanceMax: 21000, paceMin: 340, paceMax: 380 },
    { type: "run", label: "Fartlek", distanceMin: 7000, distanceMax: 10000, paceMin: 300, paceMax: 350 },
  ];

  const activityValues = runTypes.map((rt, i) => {
    const dayOffset = 28 - i * 3; // spread over ~30 days
    const startDate = daysAgo(dayOffset);
    startDate.setHours(7, randomBetween(0, 30), 0, 0);
    const distance = randomBetween(rt.distanceMin, rt.distanceMax);
    const pacePerKm = randomBetween(rt.paceMin, rt.paceMax);
    const durationSeconds = Math.round((distance / 1000) * pacePerKm);

    return {
      userId,
      garminActivityId: `garmin-act-${100000 + i}`,
      activityType: rt.type,
      startTime: startDate,
      durationSeconds,
      distanceMeters: String(distance),
      avgHeartRate: randomBetween(135, 170),
      maxHeartRate: randomBetween(170, 195),
      avgPaceSecondsPerKm: String(pacePerKm),
      elevationGainMeters: randomFloat(10, 120, 0),
      calories: randomBetween(300, 900),
      trainingEffectAerobic: randomFloat(2.0, 4.5),
      trainingEffectAnaerobic: randomFloat(0.5, 3.0),
      vo2MaxActivity: randomFloat(48, 52),
      wasPlanned: false,
      rawJson: null,
    };
  });

  await db
    .insert(schema.activities)
    .values(activityValues)
    .onConflictDoNothing();
  console.log("Seeded 10 activities");

  // 8. Create user goal: half marathon in 12 weeks
  const raceDate = addDays(new Date(), 12 * 7);
  const [goal] = await db
    .insert(schema.userGoals)
    .values({
      userId,
      goalType: "race",
      raceName: "Spring Half Marathon",
      raceDate: dateStr(raceDate),
      targetDistanceMeters: 21097,
      targetTimeSeconds: 6300, // 1:45:00
      trainingDaysPerWeek: 4,
      preferredTrainingDays: ["tue", "thu", "sat", "sun"],
      preferredLongRunDay: "sun",
      constraints: null,
      status: "active",
    })
    .returning();

  console.log(`Created goal: ${goal.id}`);

  // 9. Create training plan
  const [plan] = await db
    .insert(schema.trainingPlans)
    .values({
      userId,
      goalId: goal.id,
      planVersion: 1,
      phase: "base",
      currentWeek: 1,
      totalWeeks: 12,
      weeklyMileageTargetKm: "30",
      generatedBy: "ai_initial",
      generationContext: {
        vo2Max: 50,
        restingHR: 52,
        hrvWeeklyAvg: 55,
      },
      status: "active",
    })
    .returning();

  console.log(`Created training plan: ${plan.id}`);

  // 10. Create 7 planned workouts for the current week
  const monday = getCurrentWeekMonday();

  interface WorkoutSeed {
    dayOffset: number;
    type: string;
    title: string;
    description: string;
    distanceMeters: number | null;
    durationSeconds: number | null;
    paceMinPerKm: string | null;
    hrZone: number | null;
  }

  const weekWorkouts: WorkoutSeed[] = [
    {
      dayOffset: 0, // Monday
      type: "rest",
      title: "Rest Day",
      description: "Full rest or light walking. Focus on recovery.",
      distanceMeters: null,
      durationSeconds: null,
      paceMinPerKm: null,
      hrZone: null,
    },
    {
      dayOffset: 1, // Tuesday
      type: "easy_run",
      title: "Easy Run - 6km",
      description: "Easy conversational pace. Keep heart rate in Zone 2.",
      distanceMeters: 6000,
      durationSeconds: 2100,
      paceMinPerKm: "5.83",
      hrZone: 2,
    },
    {
      dayOffset: 2, // Wednesday
      type: "rest",
      title: "Rest Day",
      description: "Active recovery. Light stretching or yoga.",
      distanceMeters: null,
      durationSeconds: null,
      paceMinPerKm: null,
      hrZone: null,
    },
    {
      dayOffset: 3, // Thursday
      type: "tempo",
      title: "Tempo Run - 7km",
      description:
        "Warmup 10min easy, then 5km at tempo pace (5:15-5:25/km), cooldown 10min easy.",
      distanceMeters: 7000,
      durationSeconds: 2400,
      paceMinPerKm: "5.33",
      hrZone: 3,
    },
    {
      dayOffset: 4, // Friday
      type: "rest",
      title: "Rest Day",
      description: "Complete rest before the weekend training block.",
      distanceMeters: null,
      durationSeconds: null,
      paceMinPerKm: null,
      hrZone: null,
    },
    {
      dayOffset: 5, // Saturday
      type: "easy_run",
      title: "Easy Run - 5km",
      description: "Short easy run to loosen up before tomorrow's long run.",
      distanceMeters: 5000,
      durationSeconds: 1800,
      paceMinPerKm: "6.00",
      hrZone: 2,
    },
    {
      dayOffset: 6, // Sunday
      type: "long_run",
      title: "Long Run - 12km",
      description:
        "Progressive long run. Start easy, finish at marathon pace. Stay hydrated.",
      distanceMeters: 12000,
      durationSeconds: 4200,
      paceMinPerKm: "5.83",
      hrZone: 2,
    },
  ];

  const workoutInserts = weekWorkouts.map((w, i) => ({
    planId: plan.id,
    scheduledDate: dateStr(addDays(monday, w.dayOffset)),
    dayOfWeek: DAYS_OF_WEEK[w.dayOffset],
    workoutType: w.type,
    title: w.title,
    description: w.description,
    targetDistanceMeters: w.distanceMeters,
    targetDurationSeconds: w.durationSeconds,
    targetPaceMinPerKm: w.paceMinPerKm,
    targetHeartRateZone: w.hrZone,
    workoutSteps: null,
    syncStatus: "pending" as const,
    completionStatus: "pending" as const,
    sortOrder: i,
  }));

  await db.insert(schema.plannedWorkouts).values(workoutInserts);
  console.log("Seeded 7 planned workouts for current week");

  console.log("\nSeed complete!");
  console.log(`Seed user email: ${SEED_EMAIL} (allowlisted)`);
  console.log(
    "Log in at /login with real Garmin credentials — the email must be in allowed_emails.",
  );
}

seed()
  .then(() => {
    client.end();
    process.exit(0);
  })
  .catch((err) => {
    console.error("Seed failed:", err);
    client.end();
    process.exit(1);
  });
