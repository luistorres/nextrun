import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getHealthDataByRange } from "@/lib/db/queries/health";
import type { TrendDirection, MetricsTrend } from "@/types/metrics";

// ---------------------------------------------------------------------------
// GET /api/metrics/trends — 30-day health data for charts + trend indicators
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const daysParam = searchParams.get("days");
    const days = daysParam ? Math.max(7, Math.min(Number(daysParam) || 30, 365)) : 30;

    const userId = session.user.id;
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - days);

    // Also fetch 28-day baseline (slightly wider window)
    const baselineStart = new Date(today);
    baselineStart.setDate(today.getDate() - 28);

    const data = await getHealthDataByRange(
      userId,
      startDate.toISOString().split("T")[0],
      today.toISOString().split("T")[0]
    );

    // Build daily data points for charts (sorted ascending)
    const dailyPoints = buildDailyPoints(data);

    // Calculate trend indicators
    const trends = calculateTrends(data);

    return NextResponse.json({ dailyPoints, trends });
  } catch (error) {
    console.error("Metrics trends error:", error);
    return NextResponse.json(
      { error: "Failed to fetch metrics trends" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface HealthData {
  summaries: Array<{
    calendarDate: string;
    restingHeartRate: number | null;
    bodyBatteryStart: number | null;
    bodyBatteryEnd: number | null;
    vo2Max: string | null;
    steps: number | null;
    averageStressLevel: number | null;
  }>;
  sleep: Array<{
    calendarDate: string;
    sleepScore: number | null;
    totalSleepSeconds: number | null;
  }>;
  hrv: Array<{
    calendarDate: string;
    hrvLastNight: string | null;
    hrvWeeklyAvg: string | null;
  }>;
  stress: Array<{
    calendarDate: string;
    avgStress: number | null;
    maxStress: number | null;
  }>;
}

function buildDailyPoints(data: HealthData) {
  // Create a map of date -> combined data
  const dateMap = new Map<
    string,
    {
      date: string;
      hrv: number | null;
      sleepScore: number | null;
      sleepHours: number | null;
      stress: number | null;
      restingHR: number | null;
      bodyBattery: number | null;
      steps: number | null;
      vo2Max: number | null;
    }
  >();

  // Initialize from summaries
  for (const s of data.summaries) {
    dateMap.set(s.calendarDate, {
      date: s.calendarDate,
      hrv: null,
      sleepScore: null,
      sleepHours: null,
      stress: s.averageStressLevel,
      restingHR: s.restingHeartRate,
      bodyBattery: s.bodyBatteryStart,
      steps: s.steps,
      vo2Max: s.vo2Max != null ? Number(s.vo2Max) : null,
    });
  }

  // Merge HRV data
  for (const h of data.hrv) {
    const existing = dateMap.get(h.calendarDate);
    if (existing) {
      existing.hrv = h.hrvLastNight ? Number(h.hrvLastNight) : null;
    } else {
      dateMap.set(h.calendarDate, {
        date: h.calendarDate,
        hrv: h.hrvLastNight ? Number(h.hrvLastNight) : null,
        sleepScore: null,
        sleepHours: null,
        stress: null,
        restingHR: null,
        bodyBattery: null,
        steps: null,
        vo2Max: null,
      });
    }
  }

  // Merge sleep data
  for (const s of data.sleep) {
    const existing = dateMap.get(s.calendarDate);
    if (existing) {
      existing.sleepScore = s.sleepScore;
      existing.sleepHours = s.totalSleepSeconds
        ? Number((s.totalSleepSeconds / 3600).toFixed(1))
        : null;
    } else {
      dateMap.set(s.calendarDate, {
        date: s.calendarDate,
        hrv: null,
        sleepScore: s.sleepScore,
        sleepHours: s.totalSleepSeconds
          ? Number((s.totalSleepSeconds / 3600).toFixed(1))
          : null,
        stress: null,
        restingHR: null,
        bodyBattery: null,
        steps: null,
        vo2Max: null,
      });
    }
  }

  // Merge stress data
  for (const st of data.stress) {
    const existing = dateMap.get(st.calendarDate);
    if (existing) {
      if (st.avgStress != null) {
        existing.stress = st.avgStress;
      }
    } else {
      dateMap.set(st.calendarDate, {
        date: st.calendarDate,
        hrv: null,
        sleepScore: null,
        sleepHours: null,
        stress: st.avgStress,
        restingHR: null,
        bodyBattery: null,
        steps: null,
        vo2Max: null,
      });
    }
  }

  // Sort ascending by date
  return Array.from(dateMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );
}

function calculateTrends(data: HealthData): MetricsTrend[] {
  const trends: MetricsTrend[] = [];

  const avg = (arr: number[]) =>
    arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  // Split data into recent 7 days vs older 28-day baseline
  const now = new Date();
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(now.getDate() - 7);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().split("T")[0];

  // HRV trend
  const recentHrv = data.hrv
    .filter((h) => h.calendarDate >= sevenDaysAgoStr)
    .map((h) => (h.hrvLastNight ? Number(h.hrvLastNight) : null))
    .filter((v): v is number => v !== null);

  const baselineHrv = data.hrv
    .map((h) => (h.hrvLastNight ? Number(h.hrvLastNight) : null))
    .filter((v): v is number => v !== null);

  if (recentHrv.length > 0 && baselineHrv.length > 0) {
    const current = avg(recentHrv);
    const baseline = avg(baselineHrv);
    const change = baseline > 0 ? ((current - baseline) / baseline) * 100 : 0;
    trends.push({
      metric: "hrv",
      current7dAvg: Number(current.toFixed(1)),
      baseline28dAvg: Number(baseline.toFixed(1)),
      direction: getDirection(change),
      changePercent: Number(change.toFixed(1)),
      flag: change > 5 ? "positive" : change < -10 ? "negative" : "neutral",
    });
  }

  // Sleep score trend
  const recentSleep = data.sleep
    .filter((s) => s.calendarDate >= sevenDaysAgoStr)
    .map((s) => s.sleepScore)
    .filter((v): v is number => v !== null);

  const baselineSleep = data.sleep
    .map((s) => s.sleepScore)
    .filter((v): v is number => v !== null);

  if (recentSleep.length > 0 && baselineSleep.length > 0) {
    const current = avg(recentSleep);
    const baseline = avg(baselineSleep);
    const change = baseline > 0 ? ((current - baseline) / baseline) * 100 : 0;
    trends.push({
      metric: "sleep",
      current7dAvg: Number(current.toFixed(1)),
      baseline28dAvg: Number(baseline.toFixed(1)),
      direction: getDirection(change),
      changePercent: Number(change.toFixed(1)),
      flag: change > 5 ? "positive" : change < -10 ? "negative" : "neutral",
    });
  }

  // Stress trend (inverted: lower is better)
  const recentStress = data.stress
    .filter((s) => s.calendarDate >= sevenDaysAgoStr)
    .map((s) => s.avgStress)
    .filter((v): v is number => v !== null);

  const baselineStress = data.stress
    .map((s) => s.avgStress)
    .filter((v): v is number => v !== null);

  if (recentStress.length > 0 && baselineStress.length > 0) {
    const current = avg(recentStress);
    const baseline = avg(baselineStress);
    const change = baseline > 0 ? ((current - baseline) / baseline) * 100 : 0;
    trends.push({
      metric: "stress",
      current7dAvg: Number(current.toFixed(1)),
      baseline28dAvg: Number(baseline.toFixed(1)),
      direction: getDirection(change),
      changePercent: Number(change.toFixed(1)),
      // For stress, lower is better
      flag: change < -5 ? "positive" : change > 10 ? "negative" : "neutral",
    });
  }

  // Resting HR trend (inverted: lower is better)
  const recentRHR = data.summaries
    .filter((s) => s.calendarDate >= sevenDaysAgoStr)
    .map((s) => s.restingHeartRate)
    .filter((v): v is number => v !== null);

  const baselineRHR = data.summaries
    .map((s) => s.restingHeartRate)
    .filter((v): v is number => v !== null);

  if (recentRHR.length > 0 && baselineRHR.length > 0) {
    const current = avg(recentRHR);
    const baseline = avg(baselineRHR);
    const change = baseline > 0 ? ((current - baseline) / baseline) * 100 : 0;
    trends.push({
      metric: "restingHR",
      current7dAvg: Number(current.toFixed(1)),
      baseline28dAvg: Number(baseline.toFixed(1)),
      direction: getDirection(change),
      changePercent: Number(change.toFixed(1)),
      flag: change < -3 ? "positive" : change > 5 ? "negative" : "neutral",
    });
  }

  // VO2 Max trend (higher is better)
  const recentVO2 = data.summaries
    .filter((s) => s.calendarDate >= sevenDaysAgoStr)
    .map((s) => (s.vo2Max != null ? Number(s.vo2Max) : null))
    .filter((v): v is number => v !== null && v > 0);

  const baselineVO2 = data.summaries
    .map((s) => (s.vo2Max != null ? Number(s.vo2Max) : null))
    .filter((v): v is number => v !== null && v > 0);

  if (recentVO2.length > 0 && baselineVO2.length > 0) {
    const current = avg(recentVO2);
    const baseline = avg(baselineVO2);
    const change = baseline > 0 ? ((current - baseline) / baseline) * 100 : 0;
    trends.push({
      metric: "vo2Max",
      current7dAvg: Number(current.toFixed(1)),
      baseline28dAvg: Number(baseline.toFixed(1)),
      direction: getDirection(change),
      changePercent: Number(change.toFixed(1)),
      flag: change > 2 ? "positive" : change < -5 ? "negative" : "neutral",
    });
  }

  return trends;
}

function getDirection(changePercent: number): TrendDirection {
  if (changePercent > 3) return "up";
  if (changePercent < -3) return "down";
  return "stable";
}
