"use client";

import type { OnboardingStep } from "@/hooks/use-onboarding";

const STEP_LABELS: Record<OnboardingStep, string> = {
  garmin: "Connect",
  goal: "Goal",
  schedule: "Schedule",
  experience: "Experience",
  generating: "Generating",
  ready: "Ready",
};

const STEP_ORDER: OnboardingStep[] = [
  "garmin",
  "goal",
  "schedule",
  "experience",
  "generating",
  "ready",
];

interface StepperProps {
  currentStep: OnboardingStep;
}

export function Stepper({ currentStep }: StepperProps) {
  const currentIndex = STEP_ORDER.indexOf(currentStep);

  return (
    <nav aria-label="Progress" className="w-full">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-ink">
          {STEP_LABELS[currentStep]}
        </span>
        <span className="text-xs text-ink-faint">
          Step {currentIndex + 1} of {STEP_ORDER.length}
        </span>
      </div>
      <div className="mt-2 h-px w-full bg-rule">
        <div
          className="h-px bg-sage transition-all duration-300"
          style={{
            width: `${((currentIndex + 1) / STEP_ORDER.length) * 100}%`,
          }}
        />
      </div>
    </nav>
  );
}
