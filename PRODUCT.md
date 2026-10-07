# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary user: a busy adult amateur runner (currently the owner, Luís) with a job and full life, training for races around real-life constraints — variable sleep, stress, work weeks, missed sessions. Uses a Garmin watch; data syncs automatically. Personal tool built to production/product grade; no other users yet, but single-user shortcuts are not acceptable.

Usage scene is phone-first: 30-second sessions — morning glance, pre-run check, post-run feedback — on a mobile browser. Desktop is secondary, used for deeper plan review and trends analysis.

## Product Purpose

An AI running coach that generates a race training plan from the user's real Garmin data and adapts it continuously as life happens. Success: the user trusts the plan enough to follow it daily, understands every change the coach makes, and arrives at race day prepared without injury or burnout.

## Positioning

Twin pillars, equal weight:

1. **Adapts to your life** — the plan bends around sleep, stress, HRV, missed sessions, and busy weeks instead of demanding the user bend around the plan.
2. **Evidence-honest coaching** — every prescription and adaptation shows its reasoning from the user's own data. No black box, no invented precision.

Competitors' gap this occupies: Runna has strong plan mechanics but ignores recovery/readiness data; Whoop/Garmin have body-state models but weak plan execution. nextrun fuses both: today's session already adjusted for last night, with the why visible.

## Operating Context

- Garmin data via the unofficial `garmin-connect` credential flow (no official partner license): activities, sleep, HRV, stress, daily summaries, FIT files. Workouts push back to the watch.
- AI: Anthropic Claude (Opus for plan generation, Sonnet for adaptations/chat, Haiku for triage), structured outputs, post-AI guardrails (`runGuardrails`), decision matrix for when to adapt.
- Daily loop: morning readiness → today's workout → run with watch → auto-sync → post-run feedback (RPE) → adaptation check.
- Weekly loop: plan review cron, weekly adaptation, race-phase periodization (base/build/peak/taper).

## Capabilities and Constraints

- Existing capabilities: onboarding with fitness-profile inference, AI plan generation with adversarial regeneration, event- and cron-driven adaptation, coach chat, workout skip/reschedule/feedback, shoe registry with mileage, metrics trends (HRV, sleep, stress, load, VO2max), FIT decoding (laps, running dynamics), Garmin workout sync.
- VDOT is estimated conservatively from easy-run pace (owner's explicit preference); race predictions are a floor, not a forecast, and should be framed as such ("at least"). Accepting a real race result as anchor is a known future improvement.
- Health metrics are judged against personal baselines (e.g. HRV vs individual SWC band), never population norms.
- Undecided: payments/subscription (schema field exists; no billing surfaces needed now), multi-user marketing surfaces.
- Terminology: plain language over sports science (avoid raw CTL/ATL/TSB or clinical jargon in UI).

## Brand Commitments

- Name: **nextrun** Tagline in use: "Adaptive coaching for people with a full life."
- Coach voice: **calm expert friend** — supportive, direct, science-literate, never patronizing, never shaming. Negative states always ship with a concrete, kind next action. Numbers are matter-of-fact; copy is warm.

## Evidence on Hand

- Real training data: the owner's Garmin account is connected; activities, HRV, sleep, stress sync live. Design and test against this real data. `pnpm db:seed` exists for contributors without a Garmin account; never mix seeded data into a real account.
- No testimonials, customer counts, pricing, or benchmarks exist; never fabricate them.

## Product Principles

1. **One adjusted answer.** The home surface fuses readiness and prescription: today's session, already adapted for last night, with a one-line why. Never a wall of unranked metrics.
2. **Consent-based adaptation.** The coach suggests, shows what changed / which signals drove it / the effect on the race goal, and the user accepts. No silent plan rewrites.
3. **Personal baselines, plain words.** Every metric renders against the user's own band with a verdict and one actionable sentence. Score-anxiety machinery (shame-red states, unexplained scores) is banned.
4. **Life events are inputs, not failures.** "I have 35 minutes", "sick kid, missed two runs", "travel next week" are first-class flows with instant visible plan consequences; a missed workout is never rendered in shame-red.
5. **Show the assumptions.** Derived metrics expose their inputs (max HR, threshold pace, baseline windows) and let the user correct them.
