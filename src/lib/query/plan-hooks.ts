"use client";

import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { WorkoutStep } from "@/types/plan";

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

async function postJSON<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

async function patchJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkoutDetailResponse {
  workout: {
    id: string;
    scheduledDate: string;
    dayOfWeek: string;
    workoutType: string;
    title: string;
    description: string | null;
    targetDistanceMeters: number | null;
    targetDurationSeconds: number | null;
    targetPaceMinPerKm: string | null;
    targetHeartRateZone: number | null;
    workoutSteps: WorkoutStep[] | null;
    syncStatus: string;
    completionStatus: string;
    skipReason: string | null;
    rpeScore: number | null;
    perceivedDifficulty: string | null;
    completedActivityId: string | null;
    completedActivity: {
      distanceMeters: number | null;
      durationSeconds: number | null;
      avgPaceSecondsPerKm: number | null;
      avgHeartRate: number | null;
    } | null;
    linkedActivityCount: number;
    garminWorkoutId: string | null;
    sortOrder: number;
    plan: {
      id: string;
      phase: string;
      currentWeek: number;
      totalWeeks: number;
      weeklyMileageTargetKm: string;
    };
    goal: {
      id: string;
      raceName: string | null;
      raceDate: string | null;
      targetDistanceMeters: number;
    };
  };
}

export interface AdaptationItem {
  id: string;
  planId: string;
  oldPlanVersion: number;
  newPlanVersion: number;
  triggerType: string;
  changes: {
    workoutId: string;
    change: string;
    from?: string;
    to?: string;
    reason: string;
  }[];
  explanation: string;
  metricsSnapshot: Record<string, unknown> | null;
  accepted: boolean | null;
  supersededAt: string | null;
  userContext?: string | null;
  createdAt: string;
}

export interface AdaptationsResponse {
  planId: string;
  planVersion: number;
  adaptations: AdaptationItem[];
}

// ---------------------------------------------------------------------------
// useWorkoutDetail — Fetch a single workout with full details
// ---------------------------------------------------------------------------

export function useWorkoutDetail(id: string | undefined) {
  const query = useQuery<WorkoutDetailResponse>({
    queryKey: ["workout", id],
    queryFn: () => fetchJSON<WorkoutDetailResponse>(`/api/workouts/${id}`),
    enabled: !!id,
    staleTime: 2 * 60 * 1000,
    // Poll every 2s while a Garmin sync is in-flight
    refetchInterval: (query) =>
      query.state.data?.workout?.syncStatus === "syncing" ? 2000 : false,
  });
  return query;
}

// ---------------------------------------------------------------------------
// useAdaptations — Fetch adaptation history for the active plan
// ---------------------------------------------------------------------------

export function useAdaptations() {
  return useQuery<AdaptationsResponse>({
    queryKey: ["adaptations"],
    queryFn: () => fetchJSON<AdaptationsResponse>("/api/plan/adaptations"),
    staleTime: 2 * 60 * 1000,
  });
}

// Asks the server for a plan review when the app opens. The review runs in a
// worker (triage, maybe a model call), so refetch a couple of times to pick up
// a new proposal while the athlete is still here.
export function usePlanReviewOnVisit() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    fetch("/api/plan/adaptations/check", { method: "POST" })
      .then((res) => (res.ok ? res.json() : { queued: false }))
      .then(({ queued }: { queued: boolean }) => {
        if (!queued || cancelled) return;
        for (const delay of [60_000, 180_000]) {
          timers.push(
            setTimeout(
              () => queryClient.invalidateQueries({ queryKey: ["adaptations"] }),
              delay,
            ),
          );
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [queryClient]);
}

// ---------------------------------------------------------------------------
// useAcceptAdaptation — Optimistic mutation: accept a pending adaptation
// ---------------------------------------------------------------------------

export function useAcceptAdaptation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (adaptationId: string) =>
      postJSON(`/api/plan/adaptations/${adaptationId}/accept`),

    onMutate: async (adaptationId: string) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["adaptations"] });

      // Snapshot previous data
      const previous =
        queryClient.getQueryData<AdaptationsResponse>(["adaptations"]);

      // Optimistically update
      if (previous) {
        queryClient.setQueryData<AdaptationsResponse>(["adaptations"], {
          ...previous,
          adaptations: previous.adaptations.map((a) =>
            a.id === adaptationId ? { ...a, accepted: true } : a,
          ),
        });
      }

      return { previous };
    },

    onError: (_err, _id, context) => {
      // Revert on error
      if (context?.previous) {
        queryClient.setQueryData(["adaptations"], context.previous);
      }
    },

    onSettled: () => {
      // Refetch to ensure server state is synced
      queryClient.invalidateQueries({ queryKey: ["adaptations"] });
      queryClient.invalidateQueries({ queryKey: ["plan", "active"] });
    },
  });
}

// ---------------------------------------------------------------------------
// useRejectAdaptation — Optimistic mutation: reject a pending adaptation
// ---------------------------------------------------------------------------

export function useRejectAdaptation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (adaptationId: string) =>
      postJSON(`/api/plan/adaptations/${adaptationId}/reject`),

    onMutate: async (adaptationId: string) => {
      await queryClient.cancelQueries({ queryKey: ["adaptations"] });

      const previous =
        queryClient.getQueryData<AdaptationsResponse>(["adaptations"]);

      if (previous) {
        queryClient.setQueryData<AdaptationsResponse>(["adaptations"], {
          ...previous,
          adaptations: previous.adaptations.map((a) =>
            a.id === adaptationId ? { ...a, accepted: false } : a,
          ),
        });
      }

      return { previous };
    },

    onError: (_err, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["adaptations"], context.previous);
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["adaptations"] });
    },
  });
}

// ---------------------------------------------------------------------------
// useRequestAdaptation — Request an on-demand plan review
// ---------------------------------------------------------------------------

interface RequestAdaptationInput {
  context?: string;
}

interface RequestAdaptationResponse {
  adapted: boolean;
  adaptationId?: string;
  message: string;
  changes?: { workoutId: string; change: string; reason: string }[];
}

export function useRequestAdaptation() {
  const queryClient = useQueryClient();

  return useMutation<RequestAdaptationResponse, Error, RequestAdaptationInput>({
    mutationFn: (input) =>
      postJSON<RequestAdaptationResponse>("/api/plan/adaptations/request", input),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adaptations"] });
      queryClient.invalidateQueries({ queryKey: ["plan", "active"] });
    },
  });
}

// ---------------------------------------------------------------------------
// useUpdateWorkoutStatus — Mutation for marking complete/skipped/partial
// ---------------------------------------------------------------------------

export function useUpdateWorkoutStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      workoutId,
      status,
      rpeScore,
      perceivedDifficulty,
    }: {
      workoutId: string;
      status: "completed" | "skipped" | "partial" | "pending";
      rpeScore?: number;
      perceivedDifficulty?: string;
    }) => patchJSON(`/api/workouts/${workoutId}/status`, {
      status,
      ...(rpeScore !== undefined && { rpeScore }),
      ...(perceivedDifficulty !== undefined && { perceivedDifficulty }),
    }),

    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["workout", variables.workoutId],
      });
      queryClient.invalidateQueries({ queryKey: ["plan", "active"] });
    },
  });
}

// ---------------------------------------------------------------------------
// useSyncWorkout — Mutation for triggering Garmin sync
// ---------------------------------------------------------------------------

export function useSyncWorkout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (workoutId: string) =>
      postJSON(`/api/workouts/${workoutId}/sync`),

    onSuccess: (_data, workoutId) => {
      queryClient.invalidateQueries({ queryKey: ["workout", workoutId] });
      queryClient.invalidateQueries({ queryKey: ["plan", "active"] });
    },
  });
}

// ---------------------------------------------------------------------------
// useRegeneratePlan — Trigger plan regeneration
// ---------------------------------------------------------------------------

interface RegeneratePlanInput {
  goalId: string;
  isRefinement?: boolean;
}

interface RegeneratePlanResponse {
  message: string;
  jobId: string;
  goalId: string;
}

export function useRegeneratePlan() {
  const queryClient = useQueryClient();

  return useMutation<RegeneratePlanResponse, Error, RegeneratePlanInput>({
    mutationFn: (input) =>
      postJSON<RegeneratePlanResponse>("/api/plan/generate", input),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["plan", "active"] });
    },
  });
}

// ---------------------------------------------------------------------------
// useDeletePlan — Delete the active plan and remove workouts from Garmin
// ---------------------------------------------------------------------------

interface DeletePlanResponse {
  success: boolean;
  deleted: {
    planId: string;
    workouts: number;
    garminDeletesQueued: number;
  };
}

async function deleteJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export function useDeletePlan() {
  const queryClient = useQueryClient();

  return useMutation<DeletePlanResponse, Error>({
    mutationFn: () => deleteJSON<DeletePlanResponse>("/api/plan"),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["plan", "active"] });
      queryClient.invalidateQueries({ queryKey: ["adaptations"] });
    },
  });
}

// ---------------------------------------------------------------------------
// useWorkoutFeedback — Fetch feedback for a specific workout
// ---------------------------------------------------------------------------

interface WorkoutFeedbackResponse {
  feedback: {
    id: string;
    sentiment: string | null;
    contextualNotes: string | null;
    painAreas: { area: string; severity: string }[] | null;
    externalStressors: string[] | null;
    feedbackType: string;
    createdAt: string;
  } | null;
}

export function useWorkoutFeedback(workoutId: string | undefined) {
  return useQuery<WorkoutFeedbackResponse>({
    queryKey: ["workout", workoutId, "feedback"],
    queryFn: () =>
      fetchJSON<WorkoutFeedbackResponse>(
        `/api/workouts/${workoutId}/feedback`,
      ),
    enabled: !!workoutId,
    staleTime: 2 * 60 * 1000,
  });
}

// ---------------------------------------------------------------------------
// useSubmitWorkoutFeedback — Submit feedback for a specific workout
// ---------------------------------------------------------------------------

interface SubmitFeedbackInput {
  workoutId: string;
  sentiment?: string;
  contextualNotes?: string;
  painAreas?: { area: string; severity: string }[];
  externalStressors?: string[];
  feedbackType?: string;
  reasonForMiss?: string;
}

export function useSubmitWorkoutFeedback() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ workoutId, ...body }: SubmitFeedbackInput) =>
      postJSON(`/api/workouts/${workoutId}/feedback`, body),

    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["workout", variables.workoutId, "feedback"],
      });
      queryClient.invalidateQueries({ queryKey: ["feedback", "daily"] });
    },
  });
}

// ---------------------------------------------------------------------------
// useSkipWorkout — Skip a workout with an optional reason
// ---------------------------------------------------------------------------

export function useSkipWorkout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      workoutId,
      reason,
    }: {
      workoutId: string;
      reason?: string;
    }) => postJSON(`/api/workouts/${workoutId}/skip`, { reason }),

    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["workout", variables.workoutId],
      });
      queryClient.invalidateQueries({ queryKey: ["plan", "active"] });
    },
  });
}

// ---------------------------------------------------------------------------
// useRescheduleWorkout — Move a workout to a new date
// ---------------------------------------------------------------------------

export function useRescheduleWorkout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      workoutId,
      newDate,
    }: {
      workoutId: string;
      newDate: string;
    }) => postJSON(`/api/workouts/${workoutId}/reschedule`, { newDate }),

    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["workout", variables.workoutId],
      });
      queryClient.invalidateQueries({ queryKey: ["plan", "active"] });
    },
  });
}
