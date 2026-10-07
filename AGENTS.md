# nextrun

AI-powered running coach that integrates with Garmin to create adaptive training plans.

Live: https://nextrun.fly.dev (deployed to Fly.io by GitHub Actions on every push to `main`; see `docs/DEPLOY_FLY.md`).

This file is the single agent-instructions file for Claude Code, Codex and other agents. There is deliberately no `CLAUDE.md`: Claude Code reads `AGENTS.md` natively when no `CLAUDE.md` exists, and adding one would shadow this file.

## Stack

- **Frontend:** Next.js 16 (App Router, Turbopack), React 19, Tailwind CSS 4, Recharts, TanStack Query v5
- **Auth:** NextAuth v5 (JWT strategy, credentials provider, Drizzle adapter)
- **Database:** PostgreSQL 16 + Drizzle ORM
- **Queue:** BullMQ + Redis 7 (ioredis)
- **AI:** Anthropic Claude SDK (claude-opus-5-5 plan generation, claude-sonnet-5 adaptations/chat, claude-haiku-4-5 triage; structured outputs + adaptive thinking — see `src/lib/ai/client.ts`)
- **Garmin:** unofficial [`garmin-connect`](https://github.com/Pythe1337N/garmin-connect) bridge for sign-in, data import and workout push; FIT decoding via `@garmin/fitsdk`. Official Developer Program code (OAuth 2.0 PKCE, webhooks, Training API) exists but is dormant — no UI reaches it
- **Testing:** Vitest (unit); Playwright is installed but no E2E suite exists yet

## Commands

```bash
pnpm dev              # Next.js dev server (Turbopack)
pnpm build            # Production build
pnpm test             # Run Vitest once
pnpm test:watch       # Vitest watch mode
pnpm lint             # ESLint
pnpm db:generate      # Generate Drizzle migrations from schema changes
pnpm db:migrate       # Run migrations
pnpm db:studio        # Open Drizzle Studio GUI
pnpm db:seed          # Seed test data (30 days of health, activities, plan)
pnpm worker:dev       # Start BullMQ workers with watch mode
```

## Local infrastructure

```bash
docker compose up -d   # postgres (:5432) and redis (:6379); run the app and worker with pnpm
```

## Project Structure

```
src/
├── app/
│   ├── (auth)/              # Login page (sign in with Garmin credentials)
│   ├── dashboard/           # Protected routes (plan, metrics, adaptations, onboarding)
│   ├── api/
│   │   ├── garmin/          # OAuth, sync, disconnect
│   │   ├── webhooks/garmin/ # Webhook handlers per data type
│   │   ├── plan/            # Plan generation, adaptation, retrieval
│   │   ├── workouts/        # Workout status and sync
│   │   ├── metrics/         # Health summaries and trends
│   │   └── onboarding/      # Onboarding completion
│   └── globals.css
├── components/
│   ├── ui/                  # Shared UI primitives (button, card, etc.)
│   ├── charts/              # HRV, sleep, stress, training load
│   ├── dashboard/           # Shell, providers
│   ├── plan/                # Calendar, workout/adaptation cards
│   └── onboarding/          # Stepper, goal/schedule/experience steps
├── hooks/                   # use-session, use-onboarding
├── lib/
│   ├── ai/                  # Anthropic client (retry, token tracking), prompts
│   ├── db/
│   │   ├── schema/          # Drizzle table definitions (auth, training, health, activities, garmin)
│   │   └── queries/         # Reusable query functions
│   ├── garmin/              # connect-client (unofficial bridge), importer, FIT decoding, dormant official OAuth/Training API
│   ├── plan-engine/         # Generator, adapter, periodization, pace-calculator, guardrails
│   ├── metrics/             # Baseline, training load, trends
│   ├── queue/               # BullMQ producers and queue definitions
│   └── utils/               # Encryption, validation, date helpers
├── types/                   # Shared TypeScript types
├── middleware.ts            # Auth middleware (protects /dashboard/*)
└── auth.ts                  # NextAuth config
workers/
├── index.ts                 # Registers all workers + cron jobs
├── backfill-processor.ts    # Import historical Garmin data
├── plan-generator.ts        # AI plan generation
├── connect-backfill.ts      # 90-day Garmin import + hourly sync sweep
├── event-adaptation.ts      # Plan reviews, requested when the athlete opens the app
├── fit-download.ts          # Download + decode activity FIT files; hourly reconcile
├── garmin-sync.ts           # Push workouts to Garmin (Connect API for credential logins)
└── shared/                  # Error handler, utilities
drizzle/                     # Generated migration files
scripts/                     # seed, live plan eval, manual adaptation trigger, Fly start script
```

## Key Conventions

- **Imports:** Use `@/` alias (maps to `src/`), e.g. `import { db } from "@/lib/db"`
- **TypeScript:** Strict mode enabled
- **API routes:** Validate with Zod `safeParse()` → check `auth()` session → process → return `NextResponse.json()`
- **Auth guard pattern:** `const session = await auth(); if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });`
- **Client components:** Use `"use client"` directive; styled with Tailwind + CSS custom properties
- **Queues:** Enqueue via producer functions in `src/lib/queue/producer.ts`
- **Workers:** 3 retry attempts with exponential backoff (30s–120s)
- **Garmin tokens:** Stored encrypted (AES-256-GCM) via `src/lib/utils/encryption.ts`
- **AI calls:** Use `sendMessage()` wrapper from `src/lib/ai/client.ts` (handles retries, logs token usage)

## Environment Variables

See `.env.example`. Required:
- `DATABASE_URL` — PostgreSQL connection string
- `REDIS_URL` — Redis connection string
- `AUTH_SECRET` — NextAuth secret (`openssl rand -base64 32`)
- `AUTH_URL` — App URL (http://localhost:3000)
- `ANTHROPIC_API_KEY` — Claude API key
- `ENCRYPTION_KEY` — AES key for token storage (`openssl rand -hex 32`)
- `NEXT_PUBLIC_APP_URL` — Public app URL

Optional: `GARMIN_CLIENT_ID` / `GARMIN_CLIENT_SECRET` / `GARMIN_REDIRECT_URI` — only for the dormant official OAuth path; `FIT_STORAGE_DIR` — FIT file directory (default `./storage/fit`, `/data/fit` on Fly); `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` / `TELEGRAM_WEBHOOK_SECRET` — owner notifications for waitlist signups + approve-from-Telegram

## Auth Flow

- Sign-in is **not** Garmin's official OAuth. NextAuth v5 (JWT, 30d) Credentials provider passes the user's Garmin email/password to Garmin SSO through the unofficial `garmin-connect` library; only the resulting Garmin tokens are kept (encrypted), never the password
- Sign-in gated by `allowed_emails` table (checked before any Garmin call) + Redis rate limit (5/15min per email and per IP, fail-open)
- First successful sign-in auto-creates the user and the Garmin connection
- Middleware protects `/dashboard/*` routes, redirects to `/login?callbackUrl=...`
- Public routes: `/`, `/login`, `/waitlist`, `/api/waitlist`, `/api/auth/*`, `/api/webhooks/*`
- Waitlist: `/waitlist` records interested emails (honeypot + IP rate limit); owner gets a Telegram message with an Approve button (or `/approve email`) that inserts into `allowed_emails` via `/api/webhooks/telegram`
- Session enriched with `onboardingCompleted` and `subscriptionStatus` fields

## Testing

- **Unit tests:** `src/lib/**/*.test.ts` and `src/lib/**/__tests__/` — run with `pnpm test`
- **E2E tests:** none yet — `@playwright/test` is installed, suite to be written
- Test data seeding: `pnpm db:seed` creates 30 days of realistic health/activity data

## Docs

- `README.md` — overview, setup, credits
- `docs/DEPLOY_FLY.md` — Fly.io infrastructure and deploy
- `DESIGN.md` / `PRODUCT.md` — design system and product context
- `docs/flow/` — local flow workflow state; gitignored, never commit
