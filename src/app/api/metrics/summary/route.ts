import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getLatestDailySummary,
  getHealthDataByRange,
} from "@/lib/db/queries/health";

// ---------------------------------------------------------------------------
// GET /api/metrics/summary — Today's health snapshot + 28-day baselines
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    // Get the latest daily summary for today's snapshot
    const latestSummary = await getLatestDailySummary(userId);

    // Compute 28-day baseline inline (no dependency on metrics library)
    const today = new Date();
    const twentyEightDaysAgo = new Date(today);
    twentyEightDaysAgo.setDate(today.getDate() - 28);

    const baselineData = await getHealthDataByRange(
      userId,
      twentyEightDaysAgo.toISOString().split("T")[0],
      today.toISOString().split("T")[0]
    );

    // Calculate baseline averages
    const hrvValues = baselineData.hrv
      .map((r) => (r.hrvLastNight ? Number(r.hrvLastNight) : null))
      .filter((v): v is number => v !== null);

    const sleepScores = baselineData.sleep
      .map((r) => r.sleepScore)
      .filter((v): v is number => v !== null);

    const restingHRValues = baselineData.summaries
      .map((r) => r.restingHeartRate)
      .filter((v): v is number => v !== null);

    const stressValues = baselineData.stress
      .map((r) => r.avgStress)
      .filter((v): v is number => v !== null);

    const bodyBatteryStartValues = baselineData.summaries
      .map((r) => r.bodyBatteryStart)
      .filter((v): v is number => v !== null);

    const vo2MaxValues = baselineData.summaries
      .map((r) => (r.vo2Max != null ? Number(r.vo2Max) : null))
      .filter((v): v is number => v !== null && v > 0);

    const avg = (arr: number[]) =>
      arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

    const baseline = {
      hrvAvg: avg(hrvValues),
      sleepScoreAvg: avg(sleepScores),
      restingHRAvg: avg(restingHRValues),
      stressAvg: avg(stressValues),
      bodyBatteryStartAvg: avg(bodyBatteryStartValues),
      vo2MaxAvg: avg(vo2MaxValues),
      fromDate: twentyEightDaysAgo.toISOString().split("T")[0],
      toDate: today.toISOString().split("T")[0],
      dataPoints: baselineData.summaries.length,
    };

    // Build today's snapshot from the latest available data
    const latestHrv = baselineData.hrv[0] ?? null;
    const latestSleep = baselineData.sleep[0] ?? null;
    const latestStress = baselineData.stress[0] ?? null;

    const snapshot = {
      date: latestSummary?.calendarDate ?? today.toISOString().split("T")[0],
      restingHR: latestSummary?.restingHeartRate ?? null,
      hrvLastNight: latestHrv?.hrvLastNight
        ? Number(latestHrv.hrvLastNight)
        : null,
      sleepScore: latestSleep?.sleepScore ?? null,
      sleepDurationHours: latestSleep?.totalSleepSeconds
        ? Number((latestSleep.totalSleepSeconds / 3600).toFixed(1))
        : null,
      avgStress: latestStress?.avgStress ?? latestSummary?.averageStressLevel ?? null,
      bodyBatteryStart: latestSummary?.bodyBatteryStart ?? null,
      bodyBatteryEnd: latestSummary?.bodyBatteryEnd ?? null,
      vo2Max: latestSummary?.vo2Max ? Number(latestSummary.vo2Max) : null,
      steps: latestSummary?.steps ?? null,
    };

    return NextResponse.json({ snapshot, baseline });
  } catch (error) {
    console.error("Metrics summary error:", error);
    return NextResponse.json(
      { error: "Failed to fetch metrics summary" },
      { status: 500 }
    );
  }
}
