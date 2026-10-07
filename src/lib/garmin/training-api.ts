/**
 * Garmin Training API client.
 *
 * Handles creating, scheduling, and deleting structured workouts on Garmin
 * Connect via the Training API. All requests require the user's OAuth access
 * token which is stored in the garmin_connections table.
 */

import type { GarminWorkoutDTO } from "@/types/garmin";

// ─── Configuration ──────────────────────────────────────────────────────────

const TRAINING_API_BASE = "https://apis.garmin.com/training-api";

const ENDPOINTS = {
  workouts: `${TRAINING_API_BASE}/workout`,
  workout: (id: string) => `${TRAINING_API_BASE}/workout/${id}`,
  schedule: (id: string) => `${TRAINING_API_BASE}/workout/${id}/schedule`,
} as const;

// ─── Error Types ────────────────────────────────────────────────────────────

export class GarminTrainingApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly responseBody?: string,
  ) {
    super(message);
    this.name = "GarminTrainingApiError";
  }
}

// ─── Response Types ─────────────────────────────────────────────────────────

export interface CreateWorkoutResponse {
  workoutId: string;
  workoutName: string;
  ownerId: string;
}

export interface ScheduleWorkoutResponse {
  workoutId: string;
  calendarDate: string;
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

function buildHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function handleResponse<T>(response: Response, context: string): Promise<T> {
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new GarminTrainingApiError(
      `Garmin Training API ${context} failed (${response.status}): ${body}`,
      response.status,
      body,
    );
  }
  return response.json() as Promise<T>;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Create a structured workout on Garmin Connect.
 *
 * The workout is created but NOT yet scheduled to a date. Call
 * `scheduleWorkout` afterwards to place it on the user's calendar.
 */
export async function createWorkout(
  accessToken: string,
  workout: GarminWorkoutDTO,
): Promise<CreateWorkoutResponse> {
  const response = await fetch(ENDPOINTS.workouts, {
    method: "POST",
    headers: buildHeaders(accessToken),
    body: JSON.stringify(workout),
  });

  return handleResponse<CreateWorkoutResponse>(response, "createWorkout");
}

/**
 * Schedule an existing Garmin workout to a specific calendar date.
 *
 * @param date — ISO date string (YYYY-MM-DD) for the scheduled day.
 */
export async function scheduleWorkout(
  accessToken: string,
  garminWorkoutId: string,
  date: string,
): Promise<ScheduleWorkoutResponse> {
  const response = await fetch(ENDPOINTS.schedule(garminWorkoutId), {
    method: "POST",
    headers: buildHeaders(accessToken),
    body: JSON.stringify({ date }),
  });

  return handleResponse<ScheduleWorkoutResponse>(response, "scheduleWorkout");
}

/**
 * Delete a workout from Garmin Connect.
 *
 * This also removes it from the user's calendar and watch (on next sync).
 */
export async function deleteWorkout(
  accessToken: string,
  garminWorkoutId: string,
): Promise<void> {
  const response = await fetch(ENDPOINTS.workout(garminWorkoutId), {
    method: "DELETE",
    headers: buildHeaders(accessToken),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new GarminTrainingApiError(
      `Garmin Training API deleteWorkout failed (${response.status}): ${body}`,
      response.status,
      body,
    );
  }
}

/**
 * Create a workout AND schedule it in one flow.
 *
 * Convenience wrapper that calls createWorkout then scheduleWorkout.
 * Returns the Garmin-assigned workout ID.
 */
export async function createAndScheduleWorkout(
  accessToken: string,
  workout: GarminWorkoutDTO,
  date: string,
): Promise<string> {
  const created = await createWorkout(accessToken, workout);
  await scheduleWorkout(accessToken, created.workoutId, date);
  return created.workoutId;
}
