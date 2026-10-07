"use client";

import { useState, useCallback } from "react";
import type { GoalType } from "@/types/plan";
import type { FitnessProfile } from "@/lib/metrics/fitness-profile";
import type { HealthConstraint } from "@/types/health";

// ─── Types ───────────────────────────────────────────────────────────────────

export type OnboardingStep =
  | "garmin"
  | "goal"
  | "schedule"
  | "experience"
  | "generating"
  | "ready";

/** Map day names from fitness profile (mon,tue,...) to schedule format */
const DAY_MAP: Record<string, string> = {
  mon: "monday",
  tue: "tuesday",
  wed: "wednesday",
  thu: "thursday",
  fri: "friday",
  sat: "saturday",
  sun: "sunday",
};

const STEP_ORDER: OnboardingStep[] = [
  "garmin",
  "goal",
  "schedule",
  "experience",
  "generating",
  "ready",
];

export interface GoalFormData {
  goalType: GoalType;
  raceName: string;
  raceDate: string;
  targetDistanceMeters: number;
  targetTimeSeconds: number | null;
}

export interface ScheduleFormData {
  trainingDaysPerWeek: number;
  preferredTrainingDays: string[];
  preferredLongRunDay: string;
  maxWeeklyHours: number | null;
}

export interface ExperienceFormData {
  experienceLevel: "beginner" | "intermediate" | "advanced";
  recentWeeklyMileageKm: number;
  healthConstraints: HealthConstraint[];
  constraints: string;
}

export interface OnboardingData {
  garminConnected: boolean;
  goal: GoalFormData;
  schedule: ScheduleFormData;
  experience: ExperienceFormData;
  goalId: string | null;
  planReady: boolean;
}

const DEFAULT_DATA: OnboardingData = {
  garminConnected: false,
  goal: {
    goalType: "race",
    raceName: "",
    raceDate: "",
    targetDistanceMeters: 21097, // Half marathon default
    targetTimeSeconds: null,
  },
  schedule: {
    trainingDaysPerWeek: 4,
    preferredTrainingDays: [],
    preferredLongRunDay: "saturday",
    maxWeeklyHours: null,
  },
  experience: {
    experienceLevel: "intermediate",
    recentWeeklyMileageKm: 20,
    healthConstraints: [],
    constraints: "",
  },
  goalId: null,
  planReady: false,
};

// ─── Validation ──────────────────────────────────────────────────────────────

function validateGoalStep(data: GoalFormData): string | null {
  if (!data.goalType) return "Please select a goal type.";
  if (data.goalType === "race") {
    if (!data.raceDate) return "Please select a race date.";
    const raceDate = new Date(data.raceDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (raceDate <= today) return "Race date must be in the future.";
  }
  if (!data.targetDistanceMeters || data.targetDistanceMeters < 1000) {
    return "Please select a target distance.";
  }
  return null;
}

function validateScheduleStep(data: ScheduleFormData): string | null {
  if (data.preferredTrainingDays.length < 3) {
    return "Please select at least 3 training days.";
  }
  if (data.preferredTrainingDays.length > 7) {
    return "Maximum 7 training days per week.";
  }
  if (!data.preferredLongRunDay) {
    return "Please select a preferred long run day.";
  }
  return null;
}

function validateExperienceStep(data: ExperienceFormData): string | null {
  if (!data.experienceLevel) return "Please select your experience level.";
  if (data.recentWeeklyMileageKm < 0) {
    return "Weekly mileage cannot be negative.";
  }
  return null;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useOnboarding() {
  const [currentStep, setCurrentStep] = useState<OnboardingStep>("garmin");
  const [data, setData] = useState<OnboardingData>(DEFAULT_DATA);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fitnessProfile, setFitnessProfile] = useState<FitnessProfile | null>(
    null,
  );
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileApplied, setProfileApplied] = useState(false);

  // ── Step navigation ──────────────────────────────────────────────────────

  const currentStepIndex = STEP_ORDER.indexOf(currentStep);

  const goToStep = useCallback((step: OnboardingStep) => {
    setError(null);
    setCurrentStep(step);
  }, []);

  const goNext = useCallback(() => {
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < STEP_ORDER.length) {
      setError(null);
      setCurrentStep(STEP_ORDER[nextIndex]);
    }
  }, [currentStepIndex]);

  const goBack = useCallback(() => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) {
      setError(null);
      setCurrentStep(STEP_ORDER[prevIndex]);
    }
  }, [currentStepIndex]);

  // ── Data updaters ────────────────────────────────────────────────────────

  const updateGoal = useCallback(
    (updates: Partial<GoalFormData>) => {
      setData((prev) => ({
        ...prev,
        goal: { ...prev.goal, ...updates },
      }));
    },
    [],
  );

  const updateSchedule = useCallback(
    (updates: Partial<ScheduleFormData>) => {
      setData((prev) => ({
        ...prev,
        schedule: { ...prev.schedule, ...updates },
      }));
    },
    [],
  );

  const updateExperience = useCallback(
    (updates: Partial<ExperienceFormData>) => {
      setData((prev) => ({
        ...prev,
        experience: { ...prev.experience, ...updates },
      }));
    },
    [],
  );

  const setGarminConnected = useCallback((connected: boolean) => {
    setData((prev) => ({ ...prev, garminConnected: connected }));
  }, []);

  // ── Fitness profile fetch & pre-fill ─────────────────────────────────────

  const fetchAndApplyProfile = useCallback(async () => {
    if (profileApplied) return;
    setProfileLoading(true);
    try {
      const res = await fetch("/api/onboarding/fitness-profile");
      if (!res.ok) return;
      const { profile, hasData } = (await res.json()) as {
        profile: FitnessProfile | null;
        hasData: boolean;
      };
      if (!profile || !hasData) return;

      setFitnessProfile(profile);

      // Pre-fill schedule
      setData((prev) => ({
        ...prev,
        schedule: {
          ...prev.schedule,
          trainingDaysPerWeek: profile.inferredTrainingDaysPerWeek,
          preferredTrainingDays: profile.inferredPreferredDays.map(
            (d) => DAY_MAP[d] ?? d,
          ),
          preferredLongRunDay: DAY_MAP[profile.inferredLongRunDay] ?? "sunday",
        },
        experience: {
          ...prev.experience,
          experienceLevel: profile.inferredExperienceLevel,
          recentWeeklyMileageKm: profile.recentWeeklyMileageKm,
        },
      }));
      setProfileApplied(true);
    } catch {
      // Non-fatal: just use defaults
    } finally {
      setProfileLoading(false);
    }
  }, [profileApplied]);

  /** Get suggested target time for a race distance from profile data */
  const getSuggestedTargetTime = useCallback(
    (distanceMeters: number): number | null => {
      if (!fitnessProfile) return null;
      const { predictedRaceTimes } = fitnessProfile;
      if (distanceMeters <= 5000) return predictedRaceTimes.fiveK;
      if (distanceMeters <= 10000) return predictedRaceTimes.tenK;
      if (distanceMeters <= 21097) return predictedRaceTimes.halfMarathon;
      return predictedRaceTimes.marathon;
    },
    [fitnessProfile],
  );

  // ── Step validation and advancement ──────────────────────────────────────

  const validateAndAdvance = useCallback(async () => {
    setError(null);

    // Validate current step
    if (currentStep === "goal") {
      const validationError = validateGoalStep(data.goal);
      if (validationError) {
        setError(validationError);
        return;
      }
    }

    if (currentStep === "schedule") {
      const validationError = validateScheduleStep(data.schedule);
      if (validationError) {
        setError(validationError);
        return;
      }
    }

    if (currentStep === "experience") {
      const validationError = validateExperienceStep(data.experience);
      if (validationError) {
        setError(validationError);
        return;
      }
    }

    // On experience step, submit goal + trigger plan generation, then advance
    if (currentStep === "experience") {
      setIsSubmitting(true);
      try {
        // 1. Create goal
        const goalRes = await fetch("/api/goals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            goalType: data.goal.goalType,
            raceName: data.goal.raceName || undefined,
            raceDate: data.goal.raceDate || undefined,
            targetDistanceMeters: data.goal.targetDistanceMeters,
            targetTimeSeconds: data.goal.targetTimeSeconds || undefined,
            trainingDaysPerWeek: data.schedule.preferredTrainingDays.length,
            preferredTrainingDays: data.schedule.preferredTrainingDays,
            preferredLongRunDay: data.schedule.preferredLongRunDay,
            constraints: [
              `Experience: ${data.experience.experienceLevel}`,
              `Recent weekly mileage: ${data.experience.recentWeeklyMileageKm}km`,
              data.experience.constraints || "",
            ]
              .filter(Boolean)
              .join(". "),
            healthConstraints: data.experience.healthConstraints,
          }),
        });

        if (!goalRes.ok) {
          const errBody = await goalRes.json().catch(() => ({}));
          throw new Error(
            (errBody as { error?: string }).error || "Failed to create goal",
          );
        }

        const { goal } = (await goalRes.json()) as { goal: { id: string } };
        setData((prev) => ({ ...prev, goalId: goal.id }));

        // 2. Trigger plan generation
        const planRes = await fetch("/api/plan/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ goalId: goal.id }),
        });

        if (!planRes.ok) {
          const errBody = await planRes.json().catch(() => ({}));
          throw new Error(
            (errBody as { error?: string }).error ||
              "Failed to start plan generation",
          );
        }

        // Advance to generating step
        setCurrentStep("generating");
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Something went wrong",
        );
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    // For other steps, just advance
    goNext();
  }, [currentStep, data, goNext]);

  // ── Mark plan as ready ───────────────────────────────────────────────────

  const setPlanReady = useCallback(() => {
    setData((prev) => ({ ...prev, planReady: true }));
    setCurrentStep("ready");
  }, []);

  // ── Complete onboarding ──────────────────────────────────────────────────

  const completeOnboarding = useCallback(async () => {
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/onboarding/complete", { method: "POST" });
      if (!res.ok) {
        throw new Error("Failed to complete onboarding");
      }
      // Redirect to dashboard
      window.location.href = "/dashboard";
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to complete onboarding",
      );
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  return {
    // State
    currentStep,
    currentStepIndex,
    data,
    error,
    isSubmitting,
    totalSteps: STEP_ORDER.length,

    // Fitness profile
    fitnessProfile,
    profileLoading,
    fetchAndApplyProfile,
    getSuggestedTargetTime,

    // Navigation
    goToStep,
    goNext,
    goBack,
    validateAndAdvance,

    // Data updaters
    updateGoal,
    updateSchedule,
    updateExperience,
    setGarminConnected,

    // Completion
    setPlanReady,
    completeOnboarding,
  };
}
