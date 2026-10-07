/**
 * Pre-built workout templates for common run types.
 *
 * Each template function returns WorkoutStep[] that can be stored directly
 * in the planned_workouts.workout_steps column and later converted to Garmin
 * format using the workout-formatter.
 *
 * All pace values are in seconds/km.
 * All distance values are in meters.
 * All duration values are in seconds.
 */

import type { WorkoutStep, SimpleWorkoutStep, IntervalWorkoutStep } from "@/types/plan";

// ─── Pace Helpers ───────────────────────────────────────────────────────────

export interface PaceRange {
  /** Faster bound, in seconds per km (lower number = faster) */
  min: number;
  /** Slower bound, in seconds per km (higher number = slower) */
  max: number;
}

// ─── Easy Run ───────────────────────────────────────────────────────────────

/**
 * Easy run: single steady effort at easy pace.
 *
 * @param durationSeconds - Total run duration in seconds.
 * @param pace - Target pace range (seconds/km).
 */
export function easyRunTemplate(
  durationSeconds: number,
  pace: PaceRange,
): WorkoutStep[] {
  return [
    {
      order: 1,
      type: "steady",
      durationType: "time",
      durationValue: durationSeconds,
      targetType: "pace",
      targetMin: pace.min,
      targetMax: pace.max,
      description: "Easy pace — conversational effort",
    } satisfies SimpleWorkoutStep,
  ];
}

// ─── Long Run ───────────────────────────────────────────────────────────────

/**
 * Long run: warmup + steady long effort + cooldown.
 *
 * @param distanceMeters - Main portion distance in meters.
 * @param pace - Target pace range for the main portion.
 * @param warmupSeconds - Warmup duration (default: 5 min).
 * @param cooldownSeconds - Cooldown duration (default: 5 min).
 */
export function longRunTemplate(
  distanceMeters: number,
  pace: PaceRange,
  warmupSeconds = 300,
  cooldownSeconds = 300,
): WorkoutStep[] {
  return [
    {
      order: 1,
      type: "warmup",
      durationType: "time",
      durationValue: warmupSeconds,
      targetType: "open",
      description: "Easy warmup jog",
    } satisfies SimpleWorkoutStep,
    {
      order: 2,
      type: "steady",
      durationType: "distance",
      durationValue: distanceMeters,
      targetType: "pace",
      targetMin: pace.min,
      targetMax: pace.max,
      description: "Long run — steady effort",
    } satisfies SimpleWorkoutStep,
    {
      order: 3,
      type: "cooldown",
      durationType: "time",
      durationValue: cooldownSeconds,
      targetType: "open",
      description: "Easy cooldown jog",
    } satisfies SimpleWorkoutStep,
  ];
}

// ─── Tempo Run ──────────────────────────────────────────────────────────────

/**
 * Tempo run: warmup + threshold-pace effort + cooldown.
 *
 * @param distanceMeters - Tempo portion distance in meters.
 * @param tempoPace - Target pace range for the tempo portion.
 * @param warmupSeconds - Warmup duration (default: 10 min).
 * @param cooldownSeconds - Cooldown duration (default: 10 min).
 */
export function tempoRunTemplate(
  distanceMeters: number,
  tempoPace: PaceRange,
  warmupSeconds = 600,
  cooldownSeconds = 600,
): WorkoutStep[] {
  return [
    {
      order: 1,
      type: "warmup",
      durationType: "time",
      durationValue: warmupSeconds,
      targetType: "open",
      description: "Easy warmup including a few strides",
    } satisfies SimpleWorkoutStep,
    {
      order: 2,
      type: "steady",
      durationType: "distance",
      durationValue: distanceMeters,
      targetType: "pace",
      targetMin: tempoPace.min,
      targetMax: tempoPace.max,
      description: "Tempo effort — comfortably hard",
    } satisfies SimpleWorkoutStep,
    {
      order: 3,
      type: "cooldown",
      durationType: "time",
      durationValue: cooldownSeconds,
      targetType: "open",
      description: "Easy cooldown jog",
    } satisfies SimpleWorkoutStep,
  ];
}

// ─── Interval Workout ───────────────────────────────────────────────────────

/**
 * Interval workout: warmup + repeats of work/recovery + cooldown.
 *
 * @param repeatCount - Number of intervals.
 * @param workDistanceMeters - Distance per work interval (meters).
 * @param workPace - Target pace range for work intervals.
 * @param recoveryDistanceMeters - Distance per recovery interval (meters).
 * @param warmupSeconds - Warmup duration (default: 10 min).
 * @param cooldownSeconds - Cooldown duration (default: 10 min).
 */
export function intervalTemplate(
  repeatCount: number,
  workDistanceMeters: number,
  workPace: PaceRange,
  recoveryDistanceMeters: number,
  warmupSeconds = 600,
  cooldownSeconds = 600,
): WorkoutStep[] {
  return [
    {
      order: 1,
      type: "warmup",
      durationType: "time",
      durationValue: warmupSeconds,
      targetType: "open",
      description: "Easy warmup with strides",
    } satisfies SimpleWorkoutStep,
    {
      order: 2,
      type: "interval",
      repeatCount,
      workStep: {
        durationType: "distance",
        durationValue: workDistanceMeters,
        targetType: "pace",
        targetMin: workPace.min,
        targetMax: workPace.max,
      },
      restStep: {
        durationType: "distance",
        durationValue: recoveryDistanceMeters,
        targetType: "open",
      },
    } satisfies IntervalWorkoutStep,
    {
      order: 3,
      type: "cooldown",
      durationType: "time",
      durationValue: cooldownSeconds,
      targetType: "open",
      description: "Easy cooldown jog",
    } satisfies SimpleWorkoutStep,
  ];
}

/**
 * Time-based interval workout: warmup + repeats of work/recovery by time + cooldown.
 *
 * @param repeatCount - Number of intervals.
 * @param workSeconds - Duration per work interval (seconds).
 * @param workPace - Target pace range for work intervals.
 * @param recoverySeconds - Duration per recovery interval (seconds).
 * @param warmupSeconds - Warmup duration (default: 10 min).
 * @param cooldownSeconds - Cooldown duration (default: 10 min).
 */
export function timeIntervalTemplate(
  repeatCount: number,
  workSeconds: number,
  workPace: PaceRange,
  recoverySeconds: number,
  warmupSeconds = 600,
  cooldownSeconds = 600,
): WorkoutStep[] {
  return [
    {
      order: 1,
      type: "warmup",
      durationType: "time",
      durationValue: warmupSeconds,
      targetType: "open",
      description: "Easy warmup with strides",
    } satisfies SimpleWorkoutStep,
    {
      order: 2,
      type: "interval",
      repeatCount,
      workStep: {
        durationType: "time",
        durationValue: workSeconds,
        targetType: "pace",
        targetMin: workPace.min,
        targetMax: workPace.max,
      },
      restStep: {
        durationType: "time",
        durationValue: recoverySeconds,
        targetType: "open",
      },
    } satisfies IntervalWorkoutStep,
    {
      order: 3,
      type: "cooldown",
      durationType: "time",
      durationValue: cooldownSeconds,
      targetType: "open",
      description: "Easy cooldown jog",
    } satisfies SimpleWorkoutStep,
  ];
}

// ─── Recovery Run ───────────────────────────────────────────────────────────

/**
 * Recovery run: very easy, short run.
 *
 * @param durationSeconds - Total run duration in seconds.
 * @param pace - Very easy pace range.
 */
export function recoveryRunTemplate(
  durationSeconds: number,
  pace: PaceRange,
): WorkoutStep[] {
  return [
    {
      order: 1,
      type: "steady",
      durationType: "time",
      durationValue: durationSeconds,
      targetType: "pace",
      targetMin: pace.min,
      targetMax: pace.max,
      description: "Recovery effort — very easy, no pushing",
    } satisfies SimpleWorkoutStep,
  ];
}

// ─── Race Pace Run ──────────────────────────────────────────────────────────

/**
 * Race pace run: warmup + sustained race-pace effort + cooldown.
 *
 * @param distanceMeters - Race-pace portion distance in meters.
 * @param racePace - Target race pace range.
 * @param warmupSeconds - Warmup duration (default: 10 min).
 * @param cooldownSeconds - Cooldown duration (default: 10 min).
 */
export function racePaceRunTemplate(
  distanceMeters: number,
  racePace: PaceRange,
  warmupSeconds = 600,
  cooldownSeconds = 600,
): WorkoutStep[] {
  return [
    {
      order: 1,
      type: "warmup",
      durationType: "time",
      durationValue: warmupSeconds,
      targetType: "open",
      description: "Easy warmup with race-pace strides",
    } satisfies SimpleWorkoutStep,
    {
      order: 2,
      type: "steady",
      durationType: "distance",
      durationValue: distanceMeters,
      targetType: "pace",
      targetMin: racePace.min,
      targetMax: racePace.max,
      description: "Race pace effort — practice your goal pace",
    } satisfies SimpleWorkoutStep,
    {
      order: 3,
      type: "cooldown",
      durationType: "time",
      durationValue: cooldownSeconds,
      targetType: "open",
      description: "Easy cooldown jog",
    } satisfies SimpleWorkoutStep,
  ];
}
