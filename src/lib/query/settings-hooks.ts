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

async function patchJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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

export interface UserPreferences {
  id: string;
  userId: string;
  units: "metric" | "imperial";
  paceDisplay: "min_km" | "min_mi";
  weekStartDay: "monday" | "sunday";
  theme: "dark" | "light" | "system";
  emailNotifications: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  id: string;
  name: string | null;
  email: string | null;
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

export function usePreferences() {
  return useQuery<{ preferences: UserPreferences }>({
    queryKey: ["settings", "preferences"],
    queryFn: () =>
      fetchJSON<{ preferences: UserPreferences }>(
        "/api/settings/preferences",
      ),
    staleTime: 5 * 60 * 1000,
  });
}

export function useUpdatePreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<UserPreferences>) =>
      patchJSON<{ preferences: UserPreferences }>(
        "/api/settings/preferences",
        data,
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(["settings", "preferences"], data);
    },
  });
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export function useProfile() {
  return useQuery<{ profile: UserProfile }>({
    queryKey: ["settings", "profile"],
    queryFn: () =>
      fetchJSON<{ profile: UserProfile }>("/api/settings/profile"),
    staleTime: 5 * 60 * 1000,
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string }) =>
      patchJSON<{ profile: UserProfile }>("/api/settings/profile", data),
    onSuccess: (data) => {
      queryClient.setQueryData(["settings", "profile"], data);
    },
  });
}

// ---------------------------------------------------------------------------
// Password
// ---------------------------------------------------------------------------

export function useChangePassword() {
  return useMutation({
    mutationFn: (data: { currentPassword: string; newPassword: string }) =>
      patchJSON<{ success: boolean }>("/api/settings/password", data),
  });
}
