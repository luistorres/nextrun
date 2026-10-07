"use client";

import { Stepper } from "@/components/onboarding/stepper";
import { GarminConnectStep } from "@/components/onboarding/garmin-connect-step";
import { GoalStep } from "@/components/onboarding/goal-step";
import { ScheduleStep } from "@/components/onboarding/schedule-step";
import { ExperienceStep } from "@/components/onboarding/experience-step";
import { GeneratingStep } from "@/components/onboarding/generating-step";
import { PlanReadyStep } from "@/components/onboarding/plan-ready-step";
import { useOnboarding } from "@/hooks/use-onboarding";

export default function OnboardingPage() {
  const {
    currentStep,
    data,
    error,
    isSubmitting,
    fitnessProfile,
    profileLoading,
    fetchAndApplyProfile,
    getSuggestedTargetTime,
    goNext,
    goBack,
    validateAndAdvance,
    updateGoal,
    updateSchedule,
    updateExperience,
    setGarminConnected,
    setPlanReady,
    completeOnboarding,
  } = useOnboarding();

  const hasProfile = fitnessProfile != null;
  const suggestedTargetTime = getSuggestedTargetTime(
    data.goal.targetDistanceMeters,
  );

  return (
    <div className="space-y-6">
      <Stepper currentStep={currentStep} />

      <div className="rounded-md border border-rule bg-paper-raised p-6 shadow-[0_1px_4px_rgba(38,36,31,0.06)] sm:p-8">
        {currentStep === "garmin" && (
          <GarminConnectStep
            onNext={goNext}
            onGarminConnected={setGarminConnected}
            fetchAndApplyProfile={fetchAndApplyProfile}
            fitnessProfile={fitnessProfile}
            profileLoading={profileLoading}
          />
        )}

        {currentStep === "goal" && (
          <GoalStep
            data={data.goal}
            onChange={updateGoal}
            onNext={validateAndAdvance}
            onBack={goBack}
            error={error}
            suggestedTargetTime={suggestedTargetTime}
          />
        )}

        {currentStep === "schedule" && (
          <ScheduleStep
            data={data.schedule}
            onChange={updateSchedule}
            onNext={validateAndAdvance}
            onBack={goBack}
            error={error}
            hasProfile={hasProfile}
          />
        )}

        {currentStep === "experience" && (
          <ExperienceStep
            data={data.experience}
            onChange={updateExperience}
            onNext={validateAndAdvance}
            onBack={goBack}
            error={error}
            isSubmitting={isSubmitting}
            hasProfile={hasProfile}
          />
        )}

        {currentStep === "generating" && (
          <GeneratingStep onPlanReady={setPlanReady} goalId={data.goalId} />
        )}

        {currentStep === "ready" && (
          <PlanReadyStep
            onComplete={completeOnboarding}
            isSubmitting={isSubmitting}
            error={error}
          />
        )}
      </div>
    </div>
  );
}
