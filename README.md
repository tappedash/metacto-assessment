# Needs Hub

AI-first Customer Needs platform for product teams in IT / consulting companies.

**Feature Request → AI understanding → Customer Need → PM decision → Delivery → Stakeholder update**

Clients and engineers submit Feature Requests. AI matches each one to an existing Customer Need (the underlying product problem) while the user waits, so duplicates become evidence instead of noise. PMs compare Demand with Strategic Value, decide with AI-prefilled context, and approved updates flow back to customers.

> **Status: local MVP, full workflow implemented.** All four roles (client, engineer, product manager, workspace admin) work end to end with the mock AI (no key) or OpenAI. Sign-in uses Better Auth (magic link by email, optional Google) with invitation-only onboarding.

## Quick start

Prerequisites: **Node.js ≥ 20.12** (`.nvmrc` pins 22), **Docker** (Docker Desktop) and `make`.

```bash
make            # checks prerequisites, creates .env, installs deps, starts Docker + containers,
                # migrates, seeds demo data, then starts the app on the first free port from 3000
```

`make help` lists every target. The ones you'll use most:

| Command | Does |
|---|---|
| `make` / `make run` | Everything from a fresh clone to a running app (dev server) |
| `make setup` | Prepare everything without starting the app |
| `make dev` | Start the dev server (`PORT=3100 make dev` to prefer another port) |
| `make start` | Production build and serve |
| `make check` | Types, unit tests, integration tests (reseeds) and build |
| `make seed` / `make reset` | Reset demo data / drop the database and rebuild it |
| `make health` | Call `/api/health` (`PORT=` if not 3000) |
| `make mail` | Open the Mailpit inbox |
| `make down` / `make clean` | Stop containers / also delete the database volume and `.next` |

`make` starts Docker Desktop on macOS if it isn't running, generates `BETTER_AUTH_SECRET` in `.env`, and picks the next free port if 3000 is taken (it then sets `BETTER_AUTH_URL` to that port for the run). Without make: `cp .env.example .env`, set `BETTER_AUTH_SECRET` (`openssl rand -base64 32`), then `npm install && npm run setup && npm run dev`.

## Sign in (local)

Access is invitation-only. Sign in at http://localhost:3000/login with a seeded email and **Send magic link**; the email arrives in Mailpit (http://localhost:8025), and its link signs you in.

| Role | Demo email |
|---|---|
| Client | `lena@northwind.example` (also `dana@contoso.example`, `omar@fabrikam.example`) |
| Engineer | `ravi@needs-hub.local` (also `mia@`, `jo@`) |
| Product Manager | `sam@needs-hub.local` |
| Workspace Admin | `alex@needs-hub.local` |
| Pending invitation | `maya@cedar.example`: the first sign-in creates her as a Cedar Clinics client from the invitation |

Onboarding: the Admin invites email + role (+ client account) under **Users**; the invitee gets an email and, on first sign-in (magic link or Google with that email), is created with the invited role and account. Uninvited emails can't sign in. Roles and permissions are enforced by the app (`src/domain/session.ts`, `permissions.ts`), not by the auth library.

### Google OAuth (optional)

1. Google Cloud Console → APIs & Services → **OAuth consent screen**: External, add yourself as a test user.
2. **Credentials → Create credentials → OAuth client ID** → Web application:
   - Authorized JavaScript origin: `http://localhost:3000`
   - Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
3. Put the client ID and secret in `.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, restart `make dev`. *Continue with Google* appears on the sign-in page.

Google only signs in invited or existing emails; it links to the existing user with the same email. If the app runs on another port, add that port's origin and callback too.

| URL | What |
|---|---|
| http://localhost:3000 | Sign in (magic link or Google), then your role's area |
| http://localhost:3000/api/health | Readiness: database, pgvector, AI provider, SMTP |
| http://localhost:8025 | Mailpit inbox (outbound email preview) |

Port 5433 busy? Change `DB_PORT` **and** the port in `DATABASE_URL` in `.env`.

### Check that it works

```bash
curl -s localhost:3000/api/health
# {"ok":true,"checks":{"database":{"ok":true,"pgvector":"0.8.7",...},"ai":{"provider":"mock",...},"smtp":{"ok":true}}}

curl -s -X POST localhost:3000/api/match -H 'content-type: application/json' \
  -d '{"title":"Export dashboard to Excel","why":"Finance reconciles costs in spreadsheets"}'
# {"relation":"same","needId":"...","confidence":0.91,"reason":"Describes the same problem as \"Use product data outside the platform\".",...}

npm test                  # unit tests (no database needed)
npm run test:integration  # reseeds, then the full workflow end to end (needs npm run setup)
```

## Walk through the workflow

Sign in with each demo email in turn (magic links arrive in Mailpit; *Sign out* is at the bottom of the sidebar):

1. **Lena Meyer (client)** → Share Feedback: drop `docs/demo/weekly-report-process.pdf` (or `weekly-shipment-report.csv`), optionally add a line of text, and click *Continue*. AI shows "AI reviewed your attachment" and "AI understood" (goal, current workaround, pain); correct anything and click *Yes, find matching needs*. It suggests **Use product data outside the platform** ("Is this your need?"). Click *Yes, support this need*: your request and file are now evidence.
2. **Sam Kim (PM)** → Triage holds only uncertain cases. Customer Needs shows Demand and Strategic Value separately (dark mode: very high demand, low strategic value; SSO: medium demand, very high strategic value). Open *Use product data outside the platform*: the AI Brief cites the evidence (R1, R2...), the rubric shows AI scores next to your final scores. Pick a priority, choose *Plan*, write a rationale and *Save decision*. AI drafts a customer update; edit it in Updates and *Approve & send*.
3. **Mailpit** (http://localhost:8025) shows the emails to requesters, supporters and staffed engineers.
4. **Lena Meyer** → My Activity → the Need now shows *Planned*, the update and the public rationale. Click **✦ Ask Needs Hub** (top right) and ask "What happened to my Excel request?" or "What's the latest update?". You can also attach a file there: it suggests the matching Need and offers *Share this as feedback* (nothing is submitted without you).
5. **Sam Kim (PM)** → Projects: each project has its own ticket statuses. *Identity Modernization* uses Backlog → Planned → Build → Security review → UAT → Client sign-off → Live. Add, rename, reorder or remove statuses; each belongs to a stage (Backlog, Planned, In progress, Done) that keeps permissions and Need progress working.
6. **Ravi Patel (engineer)** → My Work: move T-101 from Planned to *In Development*. The Need moves to In Development and a new update draft waits for the PM. Open the ticket and follow *Why are we building this?* to the Need and its evidence (only from staffed clients). Log Client Feedback works like Share Feedback, with client and project.
7. **Lena Meyer** → My Activity → *Your deliveries*: *Bulk rate import from CSV* is **Released** (Recent updates shows "… moved to Released"). Open it: progress (Planned → In Development → Ready for Review → Released) and updates the team shared with customers; Mia's internal note is not there. Choose *Something isn't right*, describe the problem (e.g. "I expected the import to update existing lanes, but it only adds new ones"), optionally attach a screenshot, and *Continue*: AI shows what it understood (expected / what happens / impact). Edit it or *Refine with AI*, then *Confirm and send to the team*. The ticket stays Released until the team decides.
8. **Sam Kim (PM)** → Tickets shows "1 rework request needs review". Open T-107: read the request, write a note and *Reopen ticket* (it goes back to In Development and Lena sees your note) or *Don't reopen* (the note explains why). On any ticket, post updates as *Internal only* or *Customer visible*. In Projects, the status editor sets which In-progress statuses customers see as *Ready for Review* (Identity Modernization: UAT and Client sign-off).
9. **Alex Lee (admin)** → Clients, Staffing (saves on each tick), Users, Strategic Goals, and a read-only view of Customer Needs.

| Role | Seeded users | Area |
|---|---|---|
| Client | Lena Meyer (Northwind), Dana Ruiz (Contoso), Omar Haddad (Fabrikam), + SMB clients | `/client/share`, `/client/discover`, `/client/activity`, `/client/needs/[id]`, `/client/tickets/[id]` |
| Engineer | Ravi Patel (Northwind + Contoso), Mia Chen, Jo Osei | `/engineer/work`, `/engineer/projects`, `/engineer/log`, `/engineer/updates` |
| Product Manager | Sam Kim | `/pm/triage`, `/pm/needs`, `/pm/tickets`, `/pm/projects`, `/pm/updates` |
| Workspace Admin | Alex Lee | `/admin/clients`, `/admin/staffing`, `/admin/users`, `/admin/goals`, `/admin/needs` |

`npm run db:seed` resets the demo data at any time.

## Scripts

| Script | Does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run typecheck` | TypeScript check |
| `npm test` | Unit tests (Vitest): mock AI, classification, permissions |
| `npm run test:integration` | Reseeds, then runs the end-to-end workflow and matching tests against Postgres + pgvector + Mailpit |
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
  app/                    Next.js App Router (server components + server actions)
    (auth)/login/         demo sign-in (session cookie = seeded user id)
    client/               Share Feedback, Discover, My Activity, public Need page
    pm/                   Triage, Customer Needs, Need decision screen, Tickets, Projects (statuses), Updates
    engineer/             My Work (Board/Backlog), Projects, Tickets, Needs, Log feedback, Updates
    admin/                Clients, Staffing, Users, Strategic Goals, read-only Needs
    actions/feedback.ts   intake server actions shared by clients and engineers
    api/health/route.ts   readiness check
    api/match/route.ts    synchronous matching endpoint (JSON)
  components/             shell + sidebar, share flow, UI helpers
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
    session.ts            actor resolution + role guard (every page and action)
    matching.ts           request -> embedding -> top-5 -> classification
    ai-tasks.ts           AI task schemas, instructions and mock handlers
    feedback.ts           follow-up, submit, support, Need refinement
    needs.ts              Demand / Strategic signals, evidence, visibility
    decisions.ts          AI Brief + rubric (on demand), decisions, update drafts, sending
    triage.ts             accept / move / create Need / merge
    delivery.ts           projects, tickets, moves, technical notes
    tracking.ts           public ticket statuses, ticket timeline, customer delivery views
    validation.ts         customer validation after release, rework requests and their review
    workflow.ts           per-project ticket statuses (stages, validation, PM edits)
    attachments.ts        uploads: storage, AI reading, permissions, evidence links
    assistant.ts          client "Ask Needs Hub": grounded context, answers, link checks
    admin.ts              clients, staffing, users, strategic goals
    permissions.ts        server-side role / staffing / public-field rules
  lib/
    env.ts                validated configuration
    env-loader.ts         loads .env for scripts and tests
    mailer.ts             SMTP (Mailpit) sending
drizzle/                  SQL migrations (0000 enables pgvector)
tests/unit/               no database needed
tests/integration/        workflow + matching; needs `npm run setup`
docs/architecture.md      architecture, tradeoffs, production path
product_specs/            versioned product spec (latest is the current spec)
prototypes/               static clickable UI prototypes for all four roles
diagrams/                 Excalidraw workflow diagrams; platform_blueprint.excalidraw shows every UX workflow by role
```

## Data model

Two layers that meet only through **Ticket → Customer Need**:

- **Product intelligence:** `requests` (Feature Requests, verbatim, with embeddings and match link) → `needs` (Customer Needs, with embeddings and cached AI Brief / rubric) + `supports`, `decisions`, `status_updates`.
- **Delivery:** `accounts` (clients / prospects) → `projects` (+ `project_members`, `project_statuses`) → `tickets`. Ticket statuses are configured per project; each has a stage (backlog / planned / in_progress / done) that the rules use, and maps to a public status customers see. `ticket_events` is the ticket timeline (status moves, updates, validations; each Internal only or Customer visible) and `ticket_validations` holds Looks good / rework requests.
- **Access:** `users` (admin / pm / engineer / client), `staffing` (which accounts an engineer may see), `strategic_goals`.

Demand comes from Feature Requests, supporters and accounts, never from ticket counts.

## Permissions

`src/domain/permissions.ts` (pure, unit-tested), enforced on the server:

- Engineers see evidence only for staffed accounts; contract value is Admin/PM only.
- Engineers move only their own tickets, Planned → In Development → Released; Backlog → Planned is a PM decision.
- Client users get public Need fields only (`toPublicNeed`).

## Known limitations (MVP)

- Authentication is local-MVP grade: magic links and Google via Better Auth with sessions in Postgres; no SSO/SAML, MFA or rate limiting.
- AI runs inside requests (no worker): the PM waits a moment when a Need's evidence changed or a decision is saved. Emails are sent in the request with no retries.
- Splitting a Customer Need is not implemented (merging is).
- The mock AI matches with a small built-in vocabulary and reads files with simple rules; use `AI_PROVIDER=openai` for real semantic matching, better file understanding and screenshot reading.
- Uploaded files are stored on local disk (`storage/`, gitignored); `make clean` does not delete them.

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
| `Cannot connect to the Docker daemon` | Start Docker Desktop (`make docker` does it on macOS) |
| `Invalid environment configuration` | Copy `.env.example` to `.env`; with `AI_PROVIDER=openai` set the three `OPENAI_*` variables |
| Odd matches after switching AI provider | `npm run db:seed` to re-embed with the current provider |
| Start from scratch | `make clean && make` |
