"use client";

import { useQuery } from "@tanstack/react-query";
import type {
  HealthSnapshot,
  MetricsBaseline,
  MetricsTrend,
} from "@/types/metrics";

// ---------------------------------------------------------------------------
// Fetcher helpers
// ---------------------------------------------------------------------------

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Metrics Summary
// ---------------------------------------------------------------------------

interface MetricsSummaryResponse {
  snapshot: HealthSnapshot;
  baseline: MetricsBaseline;
}

export function useMetricsSummary() {
  return useQuery<MetricsSummaryResponse>({
    queryKey: ["metrics", "summary"],
    queryFn: () => fetchJSON<MetricsSummaryResponse>("/api/metrics/summary"),
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 10 * 60 * 1000, // Refresh every 10 minutes
  });
}

// ---------------------------------------------------------------------------
// Dashboard Today (hero card state)
// ---------------------------------------------------------------------------

import type { TodayResponse } from "@/types/dashboard";

export function useDashboardToday() {
  return useQuery<TodayResponse>({
    queryKey: ["dashboard", "today"],
    queryFn: () => fetchJSON<TodayResponse>("/api/dashboard/today"),
    staleTime: 2 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}

// ---------------------------------------------------------------------------
// Metrics Trends
// ---------------------------------------------------------------------------

interface DailyPoint {
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

interface MetricsTrendsResponse {
  dailyPoints: DailyPoint[];
  trends: MetricsTrend[];
}

export function useMetricsTrends(days?: number) {
  const params = days ? `?days=${days}` : "";
  return useQuery<MetricsTrendsResponse>({
    queryKey: ["metrics", "trends", days ?? 30],
    queryFn: () => fetchJSON<MetricsTrendsResponse>(`/api/metrics/trends${params}`),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
  });
}

// ---------------------------------------------------------------------------
// Recent Activities
// ---------------------------------------------------------------------------

interface RecentActivity {
  id: string;
  type: string;
  name: string | null;
  garminType: string | null;
  startTime: string;
  durationSeconds: number;
  distanceMeters: number | null;
  avgHeartRate: number | null;
  avgPaceSecondsPerKm: number | null;
  calories: number | null;
  trainingEffectAerobic: number | null;
  trainingEffectAnaerobic: number | null;
  wasPlanned: boolean;
}

interface RecentActivitiesResponse {
  activities: RecentActivity[];
}

export function useRecentActivities(range?: { start: string; end: string }) {
  const params = range ? `?start=${range.start}&end=${range.end}` : "";
  return useQuery<RecentActivitiesResponse>({
    queryKey: ["activities", "recent", range?.start ?? "", range?.end ?? ""],
    queryFn: () =>
      fetchJSON<RecentActivitiesResponse>(`/api/activities/recent${params}`),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  });
}

// ---------------------------------------------------------------------------
// Plan Activities (all activities spanning the plan's date range)
// ---------------------------------------------------------------------------

export interface PlanActivity {
  id: string;
  type: string;
  name: string | null;
  garminType: string | null;
  startTime: string;
  durationSeconds: number;
  distanceMeters: number | null;
  avgHeartRate: number | null;
  avgPaceSecondsPerKm: number | null;
  calories: number | null;
  wasPlanned: boolean;
}

interface PlanActivitiesResponse {
  activities: PlanActivity[];
}

export function usePlanActivities() {
  return useQuery<PlanActivitiesResponse>({
    queryKey: ["plan", "activities"],
    queryFn: () => fetchJSON<PlanActivitiesResponse>("/api/plan/activities"),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
    retry: false,
  });
}

// ---------------------------------------------------------------------------
// Active Plan
// ---------------------------------------------------------------------------

interface PlanWorkout {
  id: string;
  scheduledDate: string;
  dayOfWeek: string;
  workoutType: string;
  title: string;
  description: string | null;
  targetDistanceMeters: number | null;
  targetDurationSeconds: number | null;
  completionStatus: string;
  sortOrder: number;
}

interface ActivePlanResponse {
  plan: {
    id: string;
    phase: string;
    currentWeek: number;
    totalWeeks: number;
    weeklyMileageTargetKm: string;
    status: string;
    goal: {
      id: string;
      raceName: string | null;
      raceDate: string | null;
      targetDistanceMeters: number;
    };
    workouts: PlanWorkout[];
  };
}

export function useActivePlan() {
  return useQuery<ActivePlanResponse>({
    queryKey: ["plan", "active"],
    queryFn: () => fetchJSON<ActivePlanResponse>("/api/plan"),
    staleTime: 5 * 60 * 1000,
    retry: false, // Don't retry on 404 (no plan)
  });
}

// ---------------------------------------------------------------------------
// Upcoming Workout (derived from active plan)
// ---------------------------------------------------------------------------

export function useUpcomingWorkout() {
  const planQuery = useActivePlan();

  const upcomingWorkout = (() => {
    if (!planQuery.data?.plan?.workouts) return null;

    const today = new Date().toISOString().split("T")[0];
    const pending = planQuery.data.plan.workouts
      .filter(
        (w) => w.scheduledDate >= today && w.completionStatus === "pending"
      )
      .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));

    return pending[0] ?? null;
  })();

  return {
    data: upcomingWorkout,
    isLoading: planQuery.isLoading,
    error: planQuery.error,
  };
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

interface GoalResponse {
  id: string;
  goalType: string;
  raceName: string | null;
  raceDate: string | null;
  targetDistanceMeters: number;
  targetTimeSeconds: number | null;
  trainingDaysPerWeek: number;
  preferredTrainingDays: string[];
  preferredLongRunDay: string;
  constraints: string | null;
  status: string;
  createdAt: string;
}

interface GoalsResponse {
  goals: GoalResponse[];
}

export function useGoals() {
  return useQuery<GoalsResponse>({
    queryKey: ["goals"],
    queryFn: () => fetchJSON<GoalsResponse>("/api/goals"),
    staleTime: 5 * 60 * 1000,
  });
}

// ---------------------------------------------------------------------------
// Fitness Profile
// ---------------------------------------------------------------------------

import type { FitnessProfile } from "@/lib/metrics/fitness-profile";

interface FitnessProfileResponse {
  profile: FitnessProfile | null;
  hasData: boolean;
}

export function useFitnessProfile() {
  return useQuery<FitnessProfileResponse>({
    queryKey: ["metrics", "fitnessProfile"],
    queryFn: () =>
      fetchJSON<FitnessProfileResponse>("/api/metrics/fitness-profile"),
    staleTime: 15 * 60 * 1000,
    refetchInterval: 30 * 60 * 1000,
  });
}

// Re-export types for consumer convenience
export type { DailyPoint, RecentActivity, PlanWorkout, ActivePlanResponse, GoalResponse, GoalsResponse };
