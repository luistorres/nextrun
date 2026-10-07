"use client";

import { useState } from "react";
import type { FitnessProfile } from "@/lib/metrics/fitness-profile";

interface FitnessStatsCardProps {
  profile: FitnessProfile | null;
  isLoading: boolean;
  /** Training days/week from the active goal — shown as "plan" next to actual */
  plannedDaysPerWeek?: number | null;
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

function formatRaceTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.round(totalSeconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function FitnessStatsCard({
  profile,
  isLoading,
  plannedDaysPerWeek = null,
}: FitnessStatsCardProps) {
  const [vdotInfoOpen, setVdotInfoOpen] = useState(false);
  const [expInfoOpen, setExpInfoOpen] = useState(false);

  if (isLoading) {
    return (
      <>
        <FitnessStatsSkeleton />
        <div className="sr-only" aria-live="polite">Loading fitness stats...</div>
      </>
    );
  }

  if (!profile) {
    return (
      <div className="flex h-48 items-center justify-center rounded-md border border-dashed border-rule bg-paper">
        <p className="max-w-xs text-center text-sm text-ink-faint">
          Not enough training data yet — keep logging activities on Garmin
        </p>
      </div>
    );
  }

  const vdotLabel = getVDOTLabel(profile.estimatedVDOT);
  const hasMultipleSports =
    profile.totalTrainingDaysPerWeek !== profile.inferredTrainingDaysPerWeek;

  const races = [
    { label: "5K", time: profile.predictedRaceTimes.fiveK },
    { label: "10K", time: profile.predictedRaceTimes.tenK },
    { label: "Half", time: profile.predictedRaceTimes.halfMarathon },
    { label: "Marathon", time: profile.predictedRaceTimes.marathon },
  ];

  return (
    <div className="rounded-md border border-rule bg-paper-raised shadow-[0_1px_4px_rgba(38,36,31,0.06)]">
      <div className="p-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <VDOTStatCell
            vdot={profile.estimatedVDOT}
            label={vdotLabel}
            infoOpen={vdotInfoOpen}
            onToggleInfo={() => setVdotInfoOpen((v) => !v)}
          />
          <StatCell
            label="Easy pace"
            value={formatPace(profile.avgEasyPaceSecsPerKm)}
            unit="/km"
          />
          <StatCell
            label="Weekly mileage"
            value={`${profile.recentWeeklyMileageKm}`}
            unit="km/week"
          />
        </div>

        {vdotInfoOpen && (
          <VDOTInfoSection
            vdot={profile.estimatedVDOT}
            onClose={() => setVdotInfoOpen(false)}
          />
        )}

        <div className="mt-3">
          <p className="text-[11px] font-medium text-ink-faint">
            Race times, at least
          </p>
          <p className="mb-2 text-[11px] text-ink-faint">
            Estimate from easy pace — treat as a floor, not a forecast.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {races.map((race) => (
              <div key={race.label} className="rounded bg-paper-shade px-3 py-2.5">
                <p className="text-[11px] font-medium text-ink-faint">
                  {race.label}
                </p>
                <p className="mt-0.5 font-mono text-sm font-semibold text-ink tabular-nums">
                  ≤ {formatRaceTime(race.time)}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-3">
          <StatCell
            label="Frequency (actual)"
            value={`${profile.totalTrainingDaysPerWeek}`}
            unit="days/week"
            sub={[
              hasMultipleSports
                ? `${profile.inferredTrainingDaysPerWeek} running`
                : null,
              plannedDaysPerWeek != null
                ? `plan: ${plannedDaysPerWeek} days/week`
                : null,
            ]
              .filter(Boolean)
              .join(" · ") || undefined}
          />
          <ExperienceStatCell
            value={
              profile.inferredExperienceLevel.charAt(0).toUpperCase() +
              profile.inferredExperienceLevel.slice(1)
            }
            infoOpen={expInfoOpen}
            onToggleInfo={() => setExpInfoOpen((v) => !v)}
          />
          <StatCell
            label="Resting HR"
            value={profile.restingHRAvg != null ? `${profile.restingHRAvg}` : "—"}
            unit={profile.restingHRAvg != null ? "bpm" : undefined}
          />
        </div>

        {expInfoOpen && (
          <ExperienceInfoSection onClose={() => setExpInfoOpen(false)} />
        )}

        <p className="mt-4 text-center text-[11px] text-ink-faint">
          {profile.crossTrainingCount > 0
            ? `Based on ${profile.activityCount} runs and ${profile.crossTrainingCount} sessions over ${profile.dataSpanDays} days`
            : `Based on ${profile.activityCount} runs over ${profile.dataSpanDays} days`}
        </p>
      </div>
    </div>
  );
}

function StatCell({
  label,
  value,
  unit,
  sub,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
}) {
  return (
    <div className="rounded bg-paper-shade p-3">
      <p className="text-[11px] font-medium text-ink-faint">{label}</p>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="font-mono text-xl font-semibold text-ink tabular-nums">
          {value}
        </span>
        {unit && (
          <span className="whitespace-nowrap text-xs text-ink-faint">
            {unit}
          </span>
        )}
      </div>
      {sub && <p className="mt-0.5 text-[11px] text-ink-faint">{sub}</p>}
    </div>
  );
}

function InfoButton({
  open,
  onToggle,
  label,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      onKeyDown={open ? (e) => { if (e.key === "Escape") onToggle(); } : undefined}
      className={`flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full border transition-colors ${
        open
          ? "border-ink bg-ink text-paper-raised"
          : "border-rule bg-paper-raised text-ink-faint hover:text-ink-soft"
      }`}
      aria-label={label}
      aria-expanded={open}
    >
      <svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden="true">
        <path
          d="M3.36 3.54c0-.63.48-1.08 1.14-1.08.6 0 1.08.39 1.08.96 0 .48-.24.75-.66 1.02-.42.27-.54.42-.54.78v.18h.54v-.12c0-.3.12-.48.54-.75.48-.3.72-.66.72-1.2 0-.84-.66-1.44-1.62-1.44-.96 0-1.68.6-1.74 1.56h.54v.09zm1.2 4.02c.3 0 .54-.24.54-.54s-.24-.54-.54-.54-.54.24-.54.54.24.54.54.54z"
          fill="currentColor"
        />
      </svg>
    </button>
  );
}

function VDOTStatCell({
  vdot,
  label,
  infoOpen,
  onToggleInfo,
}: {
  vdot: number;
  label: string;
  infoOpen: boolean;
  onToggleInfo: () => void;
}) {
  return (
    <div className="rounded bg-paper-shade p-3">
      <div className="flex items-center gap-1.5">
        <p className="text-[11px] font-medium text-ink-faint">Fitness (VDOT)</p>
        <InfoButton open={infoOpen} onToggle={onToggleInfo} label="What is VDOT?" />
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="font-mono text-xl font-semibold text-ink tabular-nums">
          {vdot}
        </span>
        <span className="whitespace-nowrap text-xs font-medium text-ink-soft">
          {label}
        </span>
      </div>
      <p className="mt-0.5 text-[11px] text-ink-faint">
        at least — estimated from easy pace
      </p>
    </div>
  );
}

const VDOT_SCALE = [
  { min: 0, max: 34, label: "Beginner", range: "< 35", color: "#A8B8C9" },
  { min: 35, max: 49, label: "Intermediate", range: "35–49", color: "#848B94" },
  { min: 50, max: 64, label: "Advanced", range: "50–64", color: "#545A62" },
  { min: 65, max: 85, label: "Elite", range: "65+", color: "#22252A" },
] as const;

function VDOTInfoSection({ vdot, onClose }: { vdot: number; onClose: () => void }) {
  return (
    <div className="mt-3 rounded-md border border-rule bg-paper">
      <div className="px-4 py-3.5">
        <div className="flex items-start gap-3">
          <p className="text-[12px] leading-relaxed text-ink-soft">
            <span className="font-semibold text-ink">VDOT</span> is your
            running fitness score, estimated from your easy-run pace using Jack
            Daniels&apos; pace tables. Easy pace understates what you can do
            flat out, so read it as a floor — your true number is at least
            this. It drives every training pace in your plan and adapts as you
            get fitter.
          </p>
          <CloseButton onClose={onClose} />
        </div>

        <div className="mt-3.5 flex gap-0.5">
          {VDOT_SCALE.map((tier) => {
            const isActive = vdot >= tier.min && vdot <= tier.max;
            return (
              <div key={tier.label} className="flex-1">
                <div
                  className="h-1 rounded-full"
                  style={{
                    background: isActive ? tier.color : "var(--paper-shade)",
                  }}
                />
                <p
                  className={`mt-1.5 text-center text-[10px] font-medium ${
                    isActive ? "text-ink" : "text-ink-faint"
                  }`}
                >
                  {tier.label}
                  <span className="ml-0.5 font-mono tabular-nums opacity-70">
                    {tier.range}
                  </span>
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
      className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-rule bg-paper-raised text-ink-faint transition-colors hover:bg-paper-shade hover:text-ink"
      aria-label="Close"
    >
      <svg width="8" height="8" viewBox="0 0 10 10" fill="none" aria-hidden="true">
        <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  );
}

function ExperienceStatCell({
  value,
  infoOpen,
  onToggleInfo,
}: {
  value: string;
  infoOpen: boolean;
  onToggleInfo: () => void;
}) {
  return (
    <div className="rounded bg-paper-shade p-3">
      <div className="flex items-center gap-1.5">
        <p className="text-[11px] font-medium text-ink-faint">Experience</p>
        <InfoButton
          open={infoOpen}
          onToggle={onToggleInfo}
          label="What is Experience?"
        />
      </div>
      <div className="mt-1">
        <span className="break-words text-base font-semibold text-ink sm:text-xl">
          {value}
        </span>
      </div>
      <p className="mt-0.5 text-[11px] text-ink-faint">from training history</p>
    </div>
  );
}

function ExperienceInfoSection({ onClose }: { onClose: () => void }) {
  return (
    <div className="mt-3 rounded-md border border-rule bg-paper">
      <div className="px-4 py-3.5">
        <div className="flex items-start gap-3">
          <p className="text-[12px] leading-relaxed text-ink-soft">
            <span className="font-semibold text-ink">Experience</span> reflects
            your overall training maturity — not just speed. It combines weekly
            mileage, running frequency, fitness level, and cross-training to
            gauge how seasoned a runner you are. A high VDOT with low mileage
            stays &ldquo;Intermediate&rdquo;; consistent volume can push
            Experience to &ldquo;Advanced&rdquo; even at a moderate pace.
          </p>
          <CloseButton onClose={onClose} />
        </div>
      </div>
    </div>
  );
}

function FitnessStatsSkeleton() {
  return (
    <div className="rounded-md border border-rule bg-paper-raised p-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="skeleton h-[72px]" />
        ))}
      </div>
      <div className="mt-3">
        <div className="skeleton mb-2 h-3 w-28" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="skeleton h-[52px]" />
          ))}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="skeleton h-[72px]" />
        ))}
      </div>
    </div>
  );
}
