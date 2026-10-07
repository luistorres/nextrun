# Deploying to Fly.io

Live at https://nextrun.fly.dev. Every push to `main` deploys automatically via
`.github/workflows/deploy.yml` (CI first, then `flyctl deploy`); each run is
recorded under the repo's **Deployments → production** environment.

One Fly app (`nextrun`) runs web + worker in a single machine (they share the
FIT volume, and one always-on machine is the cheapest shape). Redis is a second
tiny Fly app on the private network. Postgres is Neon (free tier, Frankfurt) —
fly Postgres was tried first but postgres-flex OOMs under 512MB and costs more
than Neon's $0.

## One-time setup

```bash
fly auth login

# Postgres: create a free project at neon.tech (or `npx neonctl projects create`),
# use the direct (non-pooler) connection string as DATABASE_URL below.
# Schema: DATABASE_URL=<neon-url> npx tsx src/lib/db/migrate.ts

# Redis
fly volumes create redis_data --region cdg --size 1 -a nextrun-redis
fly deploy -c fly.redis.toml

# Main app
fly apps create nextrun
fly volumes create fit_data --region cdg --size 1 -a nextrun

fly secrets set -a nextrun \
  DATABASE_URL=<neon-connection-string> \
  REDIS_URL=redis://nextrun-redis.internal:6379 \
  AUTH_SECRET=$(openssl rand -base64 32) \
  AUTH_URL=https://nextrun.fly.dev \
  NEXT_PUBLIC_APP_URL=https://nextrun.fly.dev \
  ENCRYPTION_KEY=$(openssl rand -hex 32) \
  ANTHROPIC_API_KEY=... \
  TELEGRAM_BOT_TOKEN=... \
  TELEGRAM_CHAT_ID=... \
  TELEGRAM_WEBHOOK_SECRET=...
```

Telegram webhook must be registered externally to
`https://nextrun.fly.dev/api/webhooks/telegram` with
`secret_token = TELEGRAM_WEBHOOK_SECRET`.

Garmin sign-in uses the unofficial `garmin-connect` bridge, so no Garmin
Developer Program secrets are needed. `GARMIN_CLIENT_ID` /
`GARMIN_CLIENT_SECRET` / `GARMIN_REDIRECT_URI` only matter if the dormant
official OAuth path is ever enabled; then point that app's OAuth callback and
webhook URLs at `https://nextrun.fly.dev`.

## Deploy

Automatic on push to `main` (needs the `FLY_API_TOKEN` repo secret). Manual:

```bash
fly deploy --ha=false   # release_command runs drizzle migrations before swap
```

## Notes

- `auto_stop_machines` is off because the BullMQ worker (hourly Garmin
  sync and FIT reconcile crons, queue consumers) lives in the web machine and must run 24/7.
- FIT files persist on the `fit_data` volume at `/data/fit`.
- Redis persists BullMQ state on `redis_data` (appendonly).
- Neon: use the direct host, not the pooler — postgres-js prepared statements
  break under pgbouncer transaction mode. TLS is enforced via sslmode=require.
- Cost: ~$5/month (512MB app machine + 256MB redis + volumes); DB is $0 on
  Neon free tier.
