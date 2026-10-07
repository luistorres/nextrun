"use client";

import { useState } from "react";
import type { FitnessProfile } from "@/lib/metrics/fitness-profile";

interface FitnessSummaryCardProps {
  profile: FitnessProfile;
}

function getVDOTLabel(vdot: number): string {
  if (vdot >= 65) return "Elite";
  if (vdot >= 50) return "Advanced";
  if (vdot >= 35) return "Intermediate";
  return "Beginner";
}

function formatPace(secsPerKm: number): string {
  const min = Math.floor(secsPerKm / 60);
  const sec = Math.round(secsPerKm % 60);
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

const ACTIVITY_LABELS: Record<string, string> = {
  cycle: "Cycling",
  swim: "Swimming",
  strength: "Strength",
  walk: "Walking",
  hike: "Hiking",
  yoga: "Yoga",
  padel: "Padel",
  hiit: "HIIT",
  kitesurf: "Kitesurf",
  other: "Other",
};

function formatActivityType(type: string): string {
  return ACTIVITY_LABELS[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
}

export function FitnessSummaryCard({ profile }: FitnessSummaryCardProps) {
  const [vdotInfoOpen, setVdotInfoOpen] = useState(false);
  const vdotLabel = getVDOTLabel(profile.estimatedVDOT);

  const hasMultipleSports =
    profile.totalTrainingDaysPerWeek !== profile.inferredTrainingDaysPerWeek;

  // Filter out "other" — unclassified Garmin activities aren't useful to display
  const visibleCrossTraining = profile.crossTrainingActivities.filter(
    (ct) => ct.activityType !== "other",
  );
  const hasCrossTraining = visibleCrossTraining.length > 0;

  return (
    <div className="rounded-md border border-rule bg-paper-raised">
      <div className="border-b border-rule px-4 py-3">
        <p className="text-sm font-semibold text-ink">Fitness profile</p>
        <p className="text-xs text-ink-faint">Read from your Garmin data</p>
      </div>

      <dl className="px-4">
        <div className="flex items-baseline justify-between border-b border-rule py-2.5">
          <dt className="text-xs text-ink-soft">Running mileage</dt>
          <dd className="font-mono text-sm tabular-nums text-ink">
            {profile.recentWeeklyMileageKm} km/week
          </dd>
        </div>
        <div className="flex items-baseline justify-between border-b border-rule py-2.5">
          <dt className="text-xs text-ink-soft">Training frequency</dt>
          <dd className="text-right">
            <span className="font-mono text-sm tabular-nums text-ink">
              {profile.totalTrainingDaysPerWeek} days/week
            </span>
            {hasMultipleSports && (
              <span className="block text-[11px] text-ink-faint">
                {profile.inferredTrainingDaysPerWeek} running
              </span>
            )}
          </dd>
        </div>
        <div className="flex items-baseline justify-between border-b border-rule py-2.5">
          <dt className="flex items-center gap-1.5 text-xs text-ink-soft">
            Fitness (VDOT)
            <button
              type="button"
              onClick={() => setVdotInfoOpen((v) => !v)}
              className="rounded-full border border-rule-strong px-1 text-[10px] leading-tight text-ink-faint transition-colors hover:border-pencil-red hover:text-pencil-red"
              aria-label="What is VDOT?"
              aria-expanded={vdotInfoOpen}
            >
              ?
            </button>
          </dt>
          <dd className="font-mono text-sm tabular-nums text-ink">
            {profile.estimatedVDOT}{" "}
            <span className="text-xs text-ink-soft">{vdotLabel}</span>
          </dd>
        </div>
        {vdotInfoOpen && (
          <VDOTInfoSection
            vdot={profile.estimatedVDOT}
            onClose={() => setVdotInfoOpen(false)}
          />
        )}
        {profile.restingHRAvg != null && (
          <div className="flex items-baseline justify-between border-b border-rule py-2.5">
            <dt className="text-xs text-ink-soft">Resting HR</dt>
            <dd className="font-mono text-sm tabular-nums text-ink">
              {profile.restingHRAvg} bpm
            </dd>
          </div>
        )}
        <div className="flex items-baseline justify-between py-2.5">
          <dt className="text-xs text-ink-soft">Easy pace</dt>
          <dd className="font-mono text-sm tabular-nums text-ink">
            {formatPace(profile.avgEasyPaceSecsPerKm)}/km
          </dd>
        </div>
      </dl>

      {hasCrossTraining && (
        <div className="border-t border-rule px-4 py-2.5">
          <p className="text-xs text-ink-soft">Cross-training</p>
          <p className="mt-1 text-sm text-ink">
            {visibleCrossTraining
              .map((ct) => `${formatActivityType(ct.activityType)} ${ct.count}x`)
              .join(" · ")}
          </p>
        </div>
      )}

      <p className="border-t border-rule px-4 py-2.5 text-[11px] text-ink-faint">
        {profile.crossTrainingCount > 0
          ? `Based on ${profile.activityCount} runs and ${profile.crossTrainingCount} other sessions over the last ${profile.dataSpanDays} days`
          : `Based on ${profile.activityCount} runs over the last ${profile.dataSpanDays} days`}
      </p>
    </div>
  );
}

const VDOT_SCALE = [
  { min: 0, max: 34, label: "Beginner", range: "< 35" },
  { min: 35, max: 49, label: "Intermediate", range: "35–49" },
  { min: 50, max: 64, label: "Advanced", range: "50–64" },
  { min: 65, max: 85, label: "Elite", range: "65+" },
] as const;

function VDOTInfoSection({
  vdot,
  onClose,
}: {
  vdot: number;
  onClose: () => void;
}) {
  return (
    <div className="border-b border-rule bg-paper-shade px-3 py-3">
      <div className="flex items-start gap-3">
        <p className="text-xs leading-relaxed text-ink-soft">
          <span className="font-semibold text-ink">VDOT</span> is your running
          fitness score, estimated from your easy-run pace using Jack
          Daniels&apos; pace tables. It sets every training pace in your plan
          and predicts race times. As it rises, your plan adapts.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-ink-faint transition-colors hover:text-ink"
          aria-label="Close"
        >
          <svg width="8" height="8" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path
              d="M1 1l8 8M9 1l-8 8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      <div className="mt-3 flex gap-1">
        {VDOT_SCALE.map((tier) => {
          const isActive = vdot >= tier.min && vdot <= tier.max;
          return (
            <div key={tier.label} className="flex-1">
              <div
                className={`h-0.5 ${isActive ? "bg-sage" : "bg-rule"}`}
              />
              <p
                className={`mt-1.5 text-center text-[10px] font-medium ${
                  isActive ? "text-sage" : "text-ink-faint"
                }`}
              >
                {tier.label}
                <span className="ml-0.5 tabular-nums opacity-70">
                  {tier.range}
                </span>
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
