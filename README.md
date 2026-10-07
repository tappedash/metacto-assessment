# Needs Hub

AI-first Customer Needs platform for product teams in IT / consulting companies.

**Feature Request → AI understanding → Customer Need → PM decision → Delivery → Stakeholder update**

Clients and engineers submit Feature Requests. AI matches each one to an existing Customer Need (the underlying product problem) while the user waits, so duplicates become evidence instead of noise. PMs compare Demand with Strategic Value, decide with AI-prefilled context, and approved updates flow back to customers.

> **Status: local MVP skeleton.** The infrastructure, data model, AI layer and the synchronous matching path are working and tested. Role-based UI, triage, decisions, tickets and update emails are designed (see `prototypes/`) but not built yet.

## Quick start

Prerequisites: **Node.js ≥ 20.12** (`.nvmrc` pins 22) and **Docker** (Docker Desktop running).

```bash
cp .env.example .env      # AI_PROVIDER=mock: no API key needed
npm install
npm run setup             # start Postgres + Mailpit, run migrations, seed demo data
npm run dev               # http://localhost:3000
```

| URL | What |
|---|---|
| http://localhost:3000 | Status page: seeded Customer Needs + a "Try synchronous matching" form |
| http://localhost:3000/api/health | Readiness: database, pgvector, AI provider, SMTP |
| http://localhost:8025 | Mailpit inbox (outbound email preview) |

Port 3000 busy? `npm run dev -- -p 3100`. Port 5433 busy? Change `DB_PORT` **and** the port in `DATABASE_URL` in `.env`.

### Check that it works

```bash
curl -s localhost:3000/api/health
# {"ok":true,"checks":{"database":{"ok":true,"pgvector":"0.8.7",...},"ai":{"provider":"mock",...},"smtp":{"ok":true}}}

curl -s -X POST localhost:3000/api/match -H 'content-type: application/json' \
  -d '{"title":"Export dashboard to Excel","why":"Finance reconciles costs in spreadsheets"}'
# {"relation":"same","needId":"...","confidence":0.91,"reason":"Describes the same problem as \"Use product data outside the platform\".",...}

npm test                  # unit tests (no database needed)
npm run test:integration  # matching against the seeded Postgres (after npm run setup)
```

## Scripts

| Script | Does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run typecheck` | TypeScript check |
| `npm test` | Unit tests (Vitest): mock AI, classification, permissions |
| `npm run test:integration` | Integration tests against Postgres + pgvector |
| `npm run setup` | `db:up` + `db:migrate` + `db:seed` |
| `npm run db:up` / `db:down` | Start / stop Postgres and Mailpit (Docker Compose) |
| `npm run db:generate` | Generate a migration after changing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Re-seed demo data (truncates first; safe to re-run) |
| `npm run db:reset` | Drop everything, migrate, seed |

## Configuration

All variables are documented in [`.env.example`](.env.example) and validated at startup (`src/lib/env.ts`).

| Variable | Purpose |
|---|---|
| `DB_PORT`, `DATABASE_URL` | Postgres host port (Docker Compose) and connection string |
| `AI_PROVIDER` | `mock` (default, no key) or `openai` |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_EMBEDDING_MODEL` | Required when `AI_PROVIDER=openai` |
| `AI_RECORD_FIXTURES` | `true` saves OpenAI structured outputs to `fixtures/ai/` for the mock to replay |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Mailpit SMTP locally |
| `MATCH_TIMEOUT_MS` | Timeout for synchronous matching (default 3000) |

### AI providers

Domain code depends on two interfaces only (`src/ai/types.ts`): `EmbeddingProvider` and `LanguageModel`.

- **`mock`** (default): deterministic. Embeddings come from a hashing vectorizer with a small demo vocabulary (so "Excel", "CSV" and "Google Sheets" land near the same Customer Need), and each structured task has a deterministic handler. Recorded fixtures in `fixtures/ai/` are replayed first when present. Good for local development, demos and tests; not a semantic model.
- **`openai`**: `OPENAI_EMBEDDING_MODEL` for embeddings (requested at 1536 dimensions to match the pgvector column) and `OPENAI_MODEL` via the Responses API with structured outputs (zod schemas). `src/ai/openai.ts` is the only file importing the OpenAI SDK.

After switching providers, run `npm run db:seed` so stored embeddings come from the same model.

## How matching works

`POST /api/match` → `src/domain/matching.ts`:

1. Embed the request (title + why).
2. pgvector cosine search for the top-5 Customer Needs.
3. Structured classification: `same` / `related` / `new`, with `needId`, `confidence` and a customer-readable `reason`. The chosen Need must be one of the candidates.
4. Everything runs under `MATCH_TIMEOUT_MS`. On timeout or AI failure the result is `triage`: the request is never blocked, the PM decides.

## Project structure

```
src/
  app/                    Next.js App Router
    page.tsx              status page + matching form
    api/health/route.ts   readiness check
    api/match/route.ts    synchronous matching endpoint
  ai/
    types.ts              LanguageModel, EmbeddingProvider interfaces
    mock.ts               deterministic mock provider (+ fixture replay)
    openai.ts             OpenAI implementations (only SDK import)
    fixtures.ts           record / replay helpers
    index.ts              getAi(): picks provider from AI_PROVIDER
  db/
    schema.ts             Drizzle schema (pgvector columns, 1536 dims)
    client.ts             postgres-js + Drizzle client
    seed.ts, reset.ts     demo data, database reset
  domain/
    matching.ts           request -> embedding -> top-5 -> classification
    permissions.ts        server-side role / staffing / public-field rules
  lib/
    env.ts                validated configuration
    env-loader.ts         loads .env for scripts and tests
    mailer.ts             SMTP (Mailpit) sending
drizzle/                  SQL migrations (0000 enables pgvector)
tests/unit/               no database needed
tests/integration/        needs `npm run setup`
docs/architecture.md      architecture, tradeoffs, production path
product_specs/            versioned product spec (latest is the current spec)
prototypes/               static clickable UI prototypes for all four roles
diagrams/                 Excalidraw workflow diagrams
```

## Data model

Two layers that meet only through **Ticket → Customer Need**:

- **Product intelligence:** `requests` (Feature Requests, verbatim, with embeddings and match link) → `needs` (Customer Needs, with embeddings and cached AI Brief / rubric) + `supports`, `decisions`, `status_updates`.
- **Delivery:** `accounts` (clients / prospects) → `projects` (+ `project_members`) → `tickets`.
- **Access:** `users` (admin / pm / engineer / client), `staffing` (which accounts an engineer may see), `strategic_goals`.

Demand comes from Feature Requests, supporters and accounts, never from ticket counts.

## Permissions

`src/domain/permissions.ts` (pure, unit-tested), enforced on the server:

- Engineers see evidence only for staffed accounts; contract value is Admin/PM only.
- Engineers move only their own tickets, Planned → In Development → Released; Backlog → Planned is a PM decision.
- Client users get public Need fields only (`toPublicNeed`).

## Architecture

One Next.js process plus two containers (Postgres + pgvector, Mailpit). No worker or queue in the MVP: AI runs synchronously on submit, on demand when a PM opens a Need, or when the PM saves a decision. Details, tradeoffs and the production path: [`docs/architecture.md`](docs/architecture.md).

## Working conventions

- Commit messages: `feature <scope_name> : <changes_made>`, with a body explaining intent.
- Every new requirement implemented in scope gets its own commit (see [`SKILLS.MD`](SKILLS.MD)).
- Every prompt is logged in `prompts.txt` (see `CLAUDE.MD`).
- Spec changes are new timestamped files in `product_specs/`; earlier versions are never edited.

## Troubleshooting

| Problem | Fix |
|---|---|
| `port is already allocated` on `db:up` | Another container uses the port: set `DB_PORT` (and `DATABASE_URL`) in `.env` |
| `Cannot connect to the Docker daemon` | Start Docker Desktop |
| `Invalid environment configuration` | Copy `.env.example` to `.env`; with `AI_PROVIDER=openai` set the three `OPENAI_*` variables |
| Odd matches after switching AI provider | `npm run db:seed` to re-embed with the current provider |
| Start from scratch | `npm run db:reset` |
