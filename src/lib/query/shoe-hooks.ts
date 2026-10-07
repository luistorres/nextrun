"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

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

async function sendJSON<T>(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      (data as { error?: string }).error ??
        `API error: ${res.status} ${res.statusText}`,
    );
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ShoeCategory =
  | "daily_trainer"
  | "super_shoe"
  | "racing_flat"
  | "trail"
  | "stability"
  | "other";

export interface Shoe {
  id: string;
  name: string;
  brand: string | null;
  model: string | null;
  category: ShoeCategory;
  startingKm: number;
  retiredAt: string | null;
  createdAt: string;
  /** startingKm + assigned activity distance — computed by the API */
  totalKm: number;
  activityCount: number;
  lastUsedAt: string | null;
  /** Assigned run km in the last 30 days */
  recentKm: number;
  /** Assigned run count in the last 30 days */
  recentRunCount: number;
}

export interface ShoeCoverage {
  windowDays: number;
  totalRuns: number;
  assignedRuns: number;
}

export interface ShoesResponse {
  shoes: Shoe[];
  coverage: ShoeCoverage;
}

export interface ShoeAssignment {
  activityId: string;
  shoeId: string;
}

interface ShoeAssignmentsResponse {
  assignments: ShoeAssignment[];
}

// ---------------------------------------------------------------------------
// Shoes
// ---------------------------------------------------------------------------

export function useShoes() {
  return useQuery<ShoesResponse>({
    queryKey: ["shoes"],
    queryFn: () => fetchJSON<ShoesResponse>("/api/shoes"),
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateShoe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      name: string;
      brand?: string;
      model?: string;
      category: ShoeCategory;
      startingKm?: number;
    }) => sendJSON<{ shoe: Shoe }>("/api/shoes", "POST", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shoes"] });
    },
  });
}

export function useUpdateShoe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string;
      name?: string;
      brand?: string | null;
      model?: string | null;
      category?: ShoeCategory;
      startingKm?: number;
      retired?: boolean;
    }) => sendJSON<{ shoe: Shoe }>(`/api/shoes/${id}`, "PATCH", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shoes"] });
    },
  });
}

export function useDeleteShoe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      sendJSON<{ success: boolean }>(`/api/shoes/${id}`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shoes"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Activity assignments
// ---------------------------------------------------------------------------

export function useShoeAssignments(range?: { start: string; end: string }) {
  const params = range ? `?start=${range.start}&end=${range.end}` : "";
  return useQuery<ShoeAssignmentsResponse>({
    queryKey: ["shoes", "assignments", range?.start ?? "", range?.end ?? ""],
    queryFn: () =>
      fetchJSON<ShoeAssignmentsResponse>(`/api/shoes/assignments${params}`),
    staleTime: 5 * 60 * 1000,
  });
}

export function useAssignActivityShoe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      activityId,
      shoeId,
    }: {
      activityId: string;
      shoeId: string | null;
    }) =>
      sendJSON<{ activity: { id: string; shoeId: string | null } }>(
        `/api/activities/${activityId}/shoe`,
        "PATCH",
        { shoeId },
      ),
    onSuccess: () => {
      // Covers both the shoe list (mileage/coverage) and assignments
      queryClient.invalidateQueries({ queryKey: ["shoes"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Shared display helpers
// ---------------------------------------------------------------------------

export const SHOE_CATEGORY_LABELS: Record<ShoeCategory, string> = {
  daily_trainer: "Daily Trainer",
  super_shoe: "Super Shoe",
  racing_flat: "Racing Flat",
  trail: "Trail",
  stability: "Stability",
  other: "Other",
};
