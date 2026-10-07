# nextrun

[![Deploy](https://github.com/luistorres/nextrun/actions/workflows/deploy.yml/badge.svg?branch=main)](https://github.com/luistorres/nextrun/actions/workflows/deploy.yml)
[![CI](https://github.com/luistorres/nextrun/actions/workflows/ci.yml/badge.svg)](https://github.com/luistorres/nextrun/actions/workflows/ci.yml)

AI-powered running coach that reads your Garmin data and builds an adaptive, periodized training plan.

**Live:** https://nextrun.fly.dev — invite-only; request access at [/waitlist](https://nextrun.fly.dev/waitlist).

Every push to `main` runs CI and then deploys to Fly.io. Deployment history and status are in the repo's **Deployments → production** panel and the [Deploy workflow runs](https://github.com/luistorres/nextrun/actions/workflows/deploy.yml).

## Features

- **AI-generated training plans** — Claude builds a periodized plan from your goal race, history and recovery data, then a guardrail pass rejects unsafe plans and forces a regeneration
- **Plan reviews on open** — when you open the app, nextrun checks recent training, recovery and compliance and proposes adaptations you can accept or dismiss
- **Garmin import** — 90 days of history on first sign-in, then an hourly sync of activities, sleep, HRV, stress and FIT files
- **Workout push** — scheduled workouts are sent to Garmin Connect so they appear on the watch
- **Coach chat** — ask the coach about your plan or tell it about a niggle
- **Workout interaction** — skip, reschedule, log RPE and feedback
- **Health dashboard** — HRV, sleep, stress and training load trends
- **Installable PWA** — add to home screen on iOS and Android

## Sign-in and Garmin integration

nextrun does **not** use Garmin's official OAuth or the Garmin Developer Program. You sign in with your Garmin Connect email and password, which are passed to Garmin's own login through the unofficial [`garmin-connect`](https://github.com/Pythe1337N/garmin-connect) library. nextrun never stores the password — only the Garmin session tokens that come back, encrypted with AES-256-GCM. The same library pulls activities and health data and pushes workouts.

Because it is unofficial, it can break whenever Garmin changes its login flow, and access is limited to an allow-list of emails (the waitlist).

Code for the official Garmin APIs (OAuth 2.0 with PKCE, push webhooks, Training API) is still in the repo under `src/lib/garmin/` and `src/app/api/webhooks/garmin/`, but no UI reaches it. It is there for when a Developer Program application is approved.

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router, Turbopack), React 19, Tailwind CSS 4, Recharts, TanStack Query v5 |
| Auth | NextAuth v5 (JWT, credentials provider, Drizzle adapter) |
| Database | PostgreSQL 16 + Drizzle ORM (Neon in production) |
| Queue | BullMQ + Redis 7 |
| AI | Anthropic Claude — `claude-opus-5-5` plan generation, `claude-sonnet-5` adaptations and chat, `claude-haiku-4-5` triage |
| Garmin | [`garmin-connect`](https://github.com/Pythe1337N/garmin-connect) (unofficial), [`@garmin/fitsdk`](https://www.npmjs.com/package/@garmin/fitsdk) |
| Hosting | Fly.io (web + worker on one machine, Redis as a second app) |
| Testing | Vitest (unit); Playwright installed, no E2E suite yet |

## Getting started

### Prerequisites

- Node.js 22 and pnpm
- Docker (for local Postgres + Redis)
- A Garmin Connect account
- An Anthropic API key

### Setup

```bash
pnpm install
docker compose up -d          # Postgres + Redis
cp .env.example .env          # fill in the values below
pnpm db:migrate
pnpm dev                      # web app
pnpm worker:dev               # background workers, separate terminal
```

Add your email to the `allowed_emails` table before signing in; sign-in is refused for any email not on it.

### Environment variables

Required:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/nextrun
REDIS_URL=redis://localhost:6379
AUTH_SECRET=          # openssl rand -base64 32
AUTH_URL=http://localhost:3000
ANTHROPIC_API_KEY=
ENCRYPTION_KEY=       # openssl rand -hex 32
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Optional:

```env
FIT_STORAGE_DIR=./storage/fit                                   # where FIT files are stored
TELEGRAM_BOT_TOKEN= TELEGRAM_CHAT_ID= TELEGRAM_WEBHOOK_SECRET=  # waitlist alerts + approve from Telegram
GARMIN_CLIENT_ID= GARMIN_CLIENT_SECRET= GARMIN_REDIRECT_URI=    # dormant official Garmin OAuth path
```

## Commands

```bash
pnpm dev              # Next.js dev server (Turbopack)
pnpm build            # Production build
pnpm test             # Vitest unit tests
pnpm test:watch       # Vitest watch mode
pnpm lint             # ESLint
pnpm tsc --noEmit     # Type-check
pnpm db:generate      # Generate Drizzle migrations
pnpm db:migrate       # Run migrations
pnpm db:studio        # Drizzle Studio
pnpm db:seed          # Seed 30 days of test data
pnpm worker:dev       # BullMQ workers (watch mode)
```

## Deployment

Pushes to `main` trigger `.github/workflows/deploy.yml`: CI (lint, type-check, tests), then `flyctl deploy`, which runs Drizzle migrations as the release command. Infrastructure and one-time setup are in [docs/DEPLOY_FLY.md](docs/DEPLOY_FLY.md).

## Project structure

```
src/
├── app/
│   ├── (auth)/login/        # Sign in with Garmin credentials
│   ├── waitlist/            # Public request-access form
│   ├── dashboard/           # Plan, metrics, adaptations, onboarding, settings
│   └── api/                 # plan, workouts, coach, activities, metrics, garmin, waitlist, webhooks
├── components/              # UI primitives, charts, plan, onboarding, garmin
├── lib/
│   ├── ai/                  # Claude client (retries, timeouts, token tracing), prompts
│   ├── db/                  # Drizzle schema + queries
│   ├── garmin/              # Unofficial Connect client, importer, FIT decoding, dormant official APIs
│   ├── plan-engine/         # Generator, adapter, periodization, guardrails, decision matrix
│   ├── metrics/             # Baselines, ACWR, recovery, trends
│   └── queue/               # BullMQ queues and producers
workers/
├── index.ts                 # Registers workers + hourly cron jobs
├── connect-backfill.ts      # 90-day import + hourly sync sweep
├── fit-download.ts          # FIT download/decode + hourly reconcile
├── plan-generator.ts        # AI plan generation
├── event-adaptation.ts      # Plan reviews requested when the athlete opens the app
├── garmin-sync.ts           # Push workouts to Garmin
└── backfill-processor.ts    # Official-API backfill (dormant)
```

## Docs

- [AGENTS.md](AGENTS.md) — conventions and instructions for coding agents (Claude Code, Codex)
- [docs/DEPLOY_FLY.md](docs/DEPLOY_FLY.md) — deployment
- [DESIGN.md](DESIGN.md), [PRODUCT.md](PRODUCT.md) — design system and product context

## Credits

- [**garmin-connect**](https://github.com/Pythe1337N/garmin-connect) by Oskar Bernberg ([@Pythe1337N](https://github.com/Pythe1337N)), MIT — powers sign-in and all Garmin Connect data access. nextrun would not work without it.
- [**Garmin FIT SDK**](https://developer.garmin.com/fit/) (`@garmin/fitsdk`) — FIT file decoding.

## License

[MIT](LICENSE) © 2026 Luís Torres
