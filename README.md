# Needs Hub

## 1. The problem

IT and consulting firms hear the same customer problems through many channels: client users, engineers on engagements, account calls, files and screenshots. Each arrives as a differently worded request. Product Managers spend their time reading, deduplicating and chasing context, then lose the thread back to the customers who asked once something ships.

## 2. Core thesis

> **AI turns noisy customer feedback into consolidated Customer Needs before Product Managers have to manually process it.**

- **AI handles semantic understanding:** it reads each request (text and files), plays back what it understood, finds the existing Customer Need it belongs to, and drafts briefs, scores and updates.
- **PostgreSQL handles facts and state:** requests, Needs, evidence, decisions, tickets, timelines and permissions are plain relational data (with pgvector for retrieval).
- **Humans make product decisions:** customers confirm or correct the AI, the PM decides and approves every outbound update, engineers deliver.

The core workflow, and the only one that matters for the demo:

**Customer Request → AI Understanding → Customer Need → PM Decision → Delivery → Customer Update / Validation**

## 3. Architecture in two minutes

```
 Browser (Client · Engineer · PM · Admin)
        │
 Next.js modular monolith (App Router, server actions)
   session → actor → server-side permissions (role, account, staffing)
   domain services ── AI interfaces ── OpenAI | deterministic mock
        │                    │
 Postgres 17 + pgvector   Mailpit (SMTP, local inbox)
```

- One Next.js process plus two Docker containers. No worker or queue: AI runs synchronously where the user is waiting (matching on submit, with a timeout that falls back to PM Triage) or on demand (AI Brief when the PM opens a Need).
- Matching: embed the request → pgvector top-5 Customer Needs → structured `same | related | new` classification with confidence and a customer-readable reason.
- Every AI output a person acts on is shown as a suggestion with its evidence; nothing is decided or sent by AI alone.

Details, data model and tradeoffs: [`docs/architecture.md`](docs/architecture.md). Product spec: latest file in [`product_specs/`](product_specs/). Every UX workflow on one canvas: [`diagrams/platform_blueprint.excalidraw`](diagrams/platform_blueprint.excalidraw).

## 4. Quick start

**Prerequisites:** Node.js ≥ 20.12 (`.nvmrc` pins 22), Docker Desktop (or Docker Engine with Compose v2), `make`. No OpenAI key needed.

```bash
cp .env.example .env     # optional: `make` does it for you
make run                 # = make: checks prerequisites, generates BETTER_AUTH_SECRET, installs deps,
                         #   starts Postgres+pgvector and Mailpit, migrates, seeds, starts the app
```

The app starts on http://localhost:3000, or the next free port if 3000 is taken (printed in the terminal; sign-in links follow it).

| URL | What |
|---|---|
| http://localhost:3000/login | Sign in (magic link, or Google if configured) |
| http://localhost:8025 | **Mailpit**: every email (magic links, notifications, updates) |
| http://localhost:3000/api/health | Database, pgvector, AI provider, SMTP |

| Command | Does |
|---|---|
| `make health` | Calls `/api/health` on the port `make dev` chose |
| `make test` | Unit tests (no database) |
| `make check` | Types, unit tests, integration tests (reseeds), production build |
| `make seed` | Reset demo data (safe to re-run) |
| `make down` | Stop the containers (data kept) |
| `make reset` | Drop the database, migrate and seed again |
| `make clean` | Stop containers, delete the database volume and `.next`; `make run` starts fresh |

Port 5433 taken? Set `DB_PORT` and the port in `DATABASE_URL` in `.env`.

**Optional: OpenAI.** Set `AI_PROVIDER=openai`, `OPENAI_API_KEY`, `OPENAI_MODEL` and `OPENAI_EMBEDDING_MODEL` in `.env`, then `make seed` so stored embeddings come from the same model. The default `mock` provider is deterministic and runs the whole demo offline.

**Optional: Google sign-in.** In Google Cloud Console create an OAuth client (Web application) with origin `http://localhost:3000` and redirect URI `http://localhost:3000/api/auth/callback/google`, put `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `.env`, restart. Google only signs in invited or existing emails.

**Demo users and onboarding.** Access is invitation-only: the Admin invites an email with a role (and client account); the first sign-in creates the user from the invitation. Sign in with any seeded email via *Send magic link*, then open the link in Mailpit.

| Role | Email |
|---|---|
| Client | `lena@northwind.example` (also `dana@contoso.example`, `omar@fabrikam.example`) |
| Product Manager | `sam@needs-hub.local` |
| Engineer | `ravi@needs-hub.local` (also `mia@`, `jo@`) |
| Workspace Admin | `alex@needs-hub.local` |
| Pending invitation | `maya@cedar.example` (first sign-in creates her as a Cedar Clinics client) |

## 5. Demo walkthrough (about 10 minutes)

1. **Lena (client) → Share Feedback.** Type "Get our numbers into Excel" and a line about copying costs into spreadsheets (or drop `docs/demo/weekly-report-process.pdf`). *Continue*: AI shows what it understood.
2. **Refine it.** Answer AI's question or tell it what it missed, then *Refine with AI*; or edit the fields.
3. **Match.** *Yes, find matching needs*: AI suggests **Use product data outside the platform** and why. *Yes, support this need*: the request becomes evidence instead of a duplicate.
4. **Sam (PM) → Triage.** "Handled by AI" shows the confident matches that never needed him. One borderline request (55%) waits: accept the suggestion, move it, or create a new Need.
5. **Sam → Customer Needs → the Need.** AI Brief (citing requests), Demand vs Strategic Value, AI-prefilled rubric. Choose *Plan*, a priority and a public rationale, *Save decision*. Approve the AI-drafted update under **Updates** (emails in Mailpit).
6. **Create the Delivery Ticket** on the Need page (open by default once Planned), assigned to Ravi. Ravi is notified.
7. **Ravi (engineer) → My Work.** After Sam moves it to Planned, move it to *In Development* and post a *Customer visible* update; Sam publishes it from the ticket page.
8. **Lena → My Activity.** The ticket shows *In Development* and the published update; internal notes never appear.
9. **Released → validate.** On a Released ticket (seeded: *Bulk rate import from CSV*), Lena chooses *Looks good* or *Something isn't right*. The rework form plays back what AI understood; Sam or Mia can reopen, create a follow-up ticket, or decline with a reason.

`tests/integration/demo-journey.test.ts` runs this journey end to end.

## 6. AI capability

| Where | What AI does | Who decides |
|---|---|---|
| Share Feedback | Reads description + files (PDF, Word, Excel/CSV, screenshots); plays back problem, goal, workaround, impact; refines on the customer's reply | Customer confirms or corrects |
| Matching | Embedding → pgvector top-5 → `same / related / new` + confidence + reason | Customer supports or says "mine is different"; below the Admin's threshold → PM Triage |
| Need review | AI Brief citing request IDs; rubric prefill (reach, revenue, strategic fit against the Admin's goals, severity) | PM sets final scores and the decision |
| Updates | Drafts the customer update on every Need status change | PM edits and approves; nothing is sent before |
| Rework | Reads "something isn't right" into expected / actual / impact | Customer confirms; PM or engineer decides |
| Ask Needs Hub | Answers a client's questions from their own requests, Needs and approved updates | Read-only; links outside their data are dropped |

Providers sit behind two interfaces (`LanguageModel`, `EmbeddingProvider`): OpenAI (Responses API with zod structured outputs) or a deterministic mock for offline demos and tests.

## 7. Key technical decisions and tradeoffs

- **Modular monolith, no worker.** Simplest thing that proves the workflow; AI and email run in the request with timeouts and visible errors. Production path: a jobs table + worker, an email outbox with retries.
- **Postgres + pgvector, exact search.** One store for facts and vectors; exact top-5 is fine at MVP volume (HNSW later).
- **One AI vendor + mock.** One key and SDK; the mock keeps demos and tests reproducible but is not semantic.
- **Authorization in the app.** Better Auth only answers "who is this?"; roles, client accounts and staffing are checked in the domain layer for every page and action.
- **Fixed roles and stages.** Four roles; per-project ticket statuses map to four fixed stages and four public statuses, so customers see progress without internal detail.
- **Notifications are synchronous and audited.** In-app + email per recipient, from entity relationships; no event bus.

## 8. Scope boundaries

| Class | Capabilities |
|---|---|
| **Core MVP** | Request intake (clients, and engineers on behalf of clients) with files · AI understanding and refinement · AI matching and supporting an existing Need · PM Triage for uncertain cases · Customer Needs (evidence, merge, split) · AI Brief and rubric prefill · PM decision with public rationale · AI-drafted updates approved by the PM · Delivery Tickets linked to Needs · public ticket status and customer-visible updates · customer validation and rework |
| **MVP Support** | Authentication (Better Auth: magic link, optional Google, invitation-only onboarding) · Users and fixed roles · Accounts · Projects · Staffing · Notifications (in-app + email, preferences, audit) · per-project ticket statuses · Strategic goals · Workspace settings (match threshold, customer notification defaults) · Ask Needs Hub assistant |
| **Optional Integration** | Jira (link tickets to issues, show status/assignee) · GitHub (link commits, PRs and branches to tickets) |
| **Future / out of scope** | Background worker and email retries · SSO/SAML, MFA · custom roles, permission or workflow builders · sprints, epics, story points · webhooks and automation rules · product areas, segmentation analytics · production deployment |

## 9. Optional Jira / GitHub integrations

Configured per project under **Project → Integrations** (PM: *Projects → a project*; Admin: *Projects*). Without them, tickets live in Needs Hub and everything works.

- **Jira:** site, project key, account email + API token (stored encrypted). The PM can create the Jira issue when creating a ticket or from the ticket (`T-107 → CARR-184`); the ticket shows Jira key, status, assignee, link and last sync. *Sync now* refreshes status.
- **GitHub:** one or more `owner/name` repositories (token optional for public repos). *Sync now* reads recent commits, PRs and branches and links any that mention a ticket key (`T-107` or `CARR-184`) to that ticket as **Development activity**.
- Customers never see Jira or GitHub data. The seeded *Carrier Automation* project uses an offline demo mode for both.

## 10. Testing and AI evaluation

```bash
make test               # 20 unit tests: permissions, mock AI, workflow rules
make check              # types + unit + 76 integration tests (Postgres, pgvector, Mailpit) + build
npm run eval:matching   # AI matching evaluation (read-only, on the seeded Needs)
```

Integration tests cover the demo journey, matching, triage, delivery tracking, validation and rework, notifications routing, admin configuration, integrations, and a role-by-role authorization audit.

**Matching evaluation** (`evals/matching-cases.json`, 20 cases: 6 obvious duplicates, 5 related-but-different, 5 new, 4 ambiguous) runs the product's pipeline and reports accuracy, the same/related/new breakdown, retrieval (expected Need in the top 5), confidence and every miss. Current result with the **mock** provider:

| Metric | Mock |
|---|---|
| Accuracy | 11/20 (55%) |
| same / related / new | 6/6 · 0/8 · 5/6 |
| Expected Need retrieved in top 5 | 14/14 |

Retrieval and duplicate detection work; the keyword-based mock cannot tell *related* from *same*, which is exactly the judgement the OpenAI classifier is for. Run `AI_PROVIDER=openai make seed && AI_PROVIDER=openai npm run eval:matching` with a key to measure the real model.

---

Conventions: commits `feature <scope> : <change>` (see [`SKILLS.MD`](SKILLS.MD)); every prompt is logged in `prompts.txt`; spec versions are new files in `product_specs/`.
