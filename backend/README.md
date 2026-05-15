# LoL Tracker — Backend

Node.js TypeScript monorepo. PostgreSQL + Redis + BullMQ + Drizzle + Riot API client.

> Spec: `../docs/` (tier-spec / pick-recommend-spec / ai-score-spec). This repo
> is what will eventually serve all three engines from real data.

## Layout

```
backend/
├── packages/
│   ├── shared/       # types, constants, utils used by all packages
│   ├── riot/         # Riot Games API client (rate-limited, typed)
│   └── db/           # Drizzle schema + migrations + connection
└── apps/
    └── worker/       # BullMQ workers — match collection + aggregation
```

## Prerequisites

- Node.js ≥ 20.10 LTS
- pnpm ≥ 9 (`npm i -g pnpm`)
- Docker Desktop (for local Postgres + Redis)
- Riot Games dev/personal API key

## First-time setup

```bash
# 1. Install dependencies
pnpm install

# 2. Copy env template and fill RIOT_API_KEY
cp .env.example .env
# (edit .env — set RIOT_API_KEY at minimum)

# 3. Start local Postgres + Redis
pnpm compose:up

# 4. Generate migrations from schema and apply
pnpm db:generate
pnpm db:migrate

# 5. Sanity check
pnpm typecheck
```

## Development

```bash
# Worker (BullMQ — match collectors + aggregators)
pnpm worker:dev

# Drizzle Studio (web GUI for tables)
pnpm db:studio

# Optional: pgAdmin web UI on http://localhost:5050
docker compose --profile with-admin up -d
```

## Important environment variables

| Variable | Required | Purpose |
|---|---|---|
| `RIOT_API_KEY` | yes | Riot Games API key |
| `DATABASE_URL` | yes | Postgres connection string |
| `REDIS_URL` | yes | Redis URL for BullMQ + cache |
| `WORKER_MATCH_ID_CONCURRENCY` | no | default 4 |
| `WORKER_MATCH_DETAIL_CONCURRENCY` | no | default 8 |
| `SEED_REGION` | no | default `kr` |

## Rate limits

Riot Production key: **50 req/sec, 30000 req/10min**, plus per-method limits.
Our `@lol-tracker/riot` client uses Bottleneck with response-header monitoring;
when usage crosses 80% we automatically throttle harder. See
`packages/riot/src/rate-limiter.ts`.

## Scripts

| Command | Effect |
|---|---|
| `pnpm compose:up` / `compose:down` | Local Postgres + Redis |
| `pnpm db:generate` | Generate SQL migrations from schema changes |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:studio` | Drizzle web UI |
| `pnpm worker:dev` | Run worker in tsx watch mode |
| `pnpm typecheck` | All packages |
| `pnpm build` | All packages |

## Status

- ✓ PR-1 (this PR): monorepo skeleton + Riot client + DB schema + Docker Compose
- ☐ PR-2: W1 match-id-fetcher + W2 match-detail-fetcher + challenger BFS seed
- ☐ PR-3: W3 tier-aggregator + apps/api + champions.html wired to real data
- ☐ PR-4: W4–W8 (matchup / synergy / bot-duo / copick / cohort)
- ☐ PR-5: User-triggered refresh + W10 static-data-sync + monitoring
