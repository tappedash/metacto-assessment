# Needs Hub — Architecture (local MVP)

| Field | Value |
|---|---|
| Scope | Local MVP: the simplest architecture that proves the end-to-end workflow |
| Product spec | latest file in `product_specs/` (v0.7: scope classification, configuration, notifications, optional integrations) |
| AI provider | OpenAI (single vendor), with a deterministic mock for running without a key |

## Goals

Prove this workflow on one developer machine:

**Customer Request → AI Understanding → Customer Need → PM Decision → Delivery → Customer Update / Validation**

AI handles semantic understanding, PostgreSQL handles facts and state, humans make product decisions. The full set of UX workflows by role is in `diagrams/platform_blueprint.excalidraw`.

## Scope classification

| Class | Capabilities |
|---|---|
| **Core MVP** | Request intake (clients, and engineers on behalf of clients) with files · AI understanding and refinement · AI matching and supporting an existing Need · PM Triage for uncertain cases · Customer Needs (evidence, merge, split) · AI Brief and rubric prefill · PM decision with public rationale · AI-drafted updates approved by the PM · Delivery Tickets linked to Needs · public ticket status and customer-visible updates · customer validation and rework |
| **MVP Support** | Authentication (Better Auth: magic link, optional Google, invitation-only onboarding) · Users and fixed roles · Accounts · Projects · Staffing · Notifications (in-app + email, preferences, audit) · per-project ticket statuses · Strategic goals · Workspace settings (match threshold, customer notification defaults) · Ask Needs Hub assistant |
| **Optional Integration** | Jira (link tickets to issues, show status/assignee) · GitHub (link commits, PRs and branches to tickets) |
| **Future / out of scope** | Background worker and email retries · SSO/SAML, MFA · custom roles, permission or workflow builders · sprints, epics, story points · webhooks and automation rules · product areas, segmentation analytics · production deployment |

Scope is frozen at this classification for the assessment.

Keep: a Next.js modular monolith, PostgreSQL + pgvector, OpenAI for embeddings and language tasks, Drizzle migrations, seeded demo data, server-side role/staffing permissions, synchronous AI matching on submission, structured AI outputs, Mailpit for the update loop, mock AI mode.

Deliberately removed for now (see "Production path"): a separate worker process, a job queue, a transactional email outbox, a production email-provider abstraction, retry/idempotency infrastructure, an AI audit log, deployment and scaling concerns.

## High-level design

```
 USERS (browser)
 +-------------+  +------------+  +-----------------+  +-----------------+
 | Client user |  |  Engineer  |  | Product Manager |  | Workspace Admin |
 +------+------+  +-----+------+  +--------+--------+  +--------+--------+
        |               |                  |                    |
        +---------------+---------+--------+--------------------+
                                  | HTTPS
                                  v
 +-------------------------------------------------------------------------------+
 | NEXT.JS APP  (TypeScript modular monolith)          local: next dev (host)    |
 |                                                                               |
 | UI  (App Router, one area per role)                                           |
 |   |                                                                           |
 |   v                                                                           |
 | Route handlers / server actions                                               |
 |   session auth + server-side permissions (role, staffing, public fields)      |
 |   |                                                                           |
 |   v                                                                           |
 | Domain services  (depend only on LanguageModel / EmbeddingProvider)           |
 |                                                                               |
 |   Requests & Needs            AI on submit (sync, ~3s timeout):               |
 |                                 embed -> pgvector top-5 Needs ->              |
 |                                 classify same/related/new                     |
 |                                 (structured) ; on fail -> Triage              |
 |                               then refine Need statement inline               |
 |                                                                               |
 |   Triage & Decisions          AI Brief + rubric prefill ON DEMAND:            |
 |                                 generated when PM opens a Need and            |
 |                                 evidence changed; cached on the Need          |
 |                                 (structured, cites request IDs)               |
 |                                                                               |
 |   Updates                     Draft update when PM saves decision;            |
 |                                 on approve, send emails in-request            |
 |                                 (one per recipient, errors shown)             |
 |                                                                               |
 |   Projects & Tickets          plain CRUD + delivery status                    |
 +------+-------------------------------+-------------------------+--------------+
        | SQL + vector search           | AI interfaces           | SMTP
        v                               v                         v
 +------------------------+      +---------------------+   +--------------+
 | POSTGRES 17 + pgvector |      | AI LAYER            |   | EMAIL        |
 | (Docker Compose)       |      | AI_PROVIDER=        |   | Mailpit      |
 | Drizzle migrations     |      |   openai | mock     |   | (Docker)     |
 | + seeded demo data     |      |                     |   | :1025 SMTP   |
 |                        |      | openai:             |   | :8025 inbox  |
 | accounts, users,       |      |  OPENAI_MODEL       |   |              |
 | staffing, projects,    |      |  OPENAI_EMBEDDING_  |   | demo of the  |
 | requests, needs,       |      |    MODEL            |   | stakeholder  |
 | supports, tickets,     |      |  structured outputs |   | update loop  |
 | decisions, updates     |      |                     |   +--------------+
 |                        |      | mock: replay        |
 | embeddings             |      |  recorded fixtures, |
 | (+ model, dims)        |      |  no API key         |
 +------------------------+      +---------------------+
```

## Where AI work runs (no worker)

| Task | When it runs |
|---|---|
| Match a new request | **Synchronously on submit.** Embed → pgvector top-5 Customer Needs → structured classification (`same` / `related` / `new`). ~3s timeout; on failure the request is saved and goes to PM Triage. |
| Refine the Need's problem statement | Inline, right after a request is attached to a Need. |
| AI Brief + rubric prefill | **On demand** when the PM opens a Need whose evidence changed since the last generation. Cached on the Need with the evidence count and timestamp; a "Regenerate" button forces a refresh. |
| Draft stakeholder update | When the PM saves a decision (loading state while it runs). |
| Understand a rework request | Synchronously when the customer clicks *Continue* (and again on *Refine with AI*) in "Something isn't right": description + files → expected / what happens / impact. Nothing is saved until they confirm. |
| Understand a customer request | When the customer clicks *Continue* (and again on *Refine with AI* with their reply): description + files → summary, goal, workaround, impact. |
| Send emails | When the PM approves the update: one SMTP send per recipient to Mailpit; failures are listed to the PM, no retries. |

AI outputs that the product shows as conclusions (AI Brief, rubric suggestions) store the request IDs they cite, so every conclusion stays traceable to raw customer evidence.

## AI layer

Domain services depend only on two interfaces (`src/ai/types.ts`):

- `EmbeddingProvider` — `embed(texts) → vectors`
- `LanguageModel` — `generateStructured(task)` validated against a zod schema, and `generateText(task)`

Implementations (`src/ai/`), selected by `AI_PROVIDER`:

| Provider | Embeddings | Language tasks |
|---|---|---|
| `openai` | `OPENAI_EMBEDDING_MODEL` (requested at the fixed column dimension) | `OPENAI_MODEL` with structured outputs |
| `mock` (default) | Deterministic hashing vectorizer with a small demo vocabulary, so the seeded demo matches without a key | Deterministic task handlers (e.g. similarity thresholds for classification); replays recorded fixtures when present |

Only the OpenAI implementations import the OpenAI SDK.

## Data

PostgreSQL 17 with pgvector, schema in `src/db/schema.ts`, migrations in `drizzle/` (generated by Drizzle Kit; the first migration enables the `vector` extension). Embeddings are stored on requests and Customer Needs in a fixed-dimension column (1536). Changing the embedding dimension means a migration and re-embedding.

Two separate layers that meet only through Ticket → Customer Need:

- Product intelligence: Feature Request → Customer Need (+ supports, decisions, status updates)
- Delivery: Account (client) → Project → Ticket, with ticket statuses configured per project (each mapped to a fixed stage that the rules use and a public status customers see); `ticket_events` (timeline with visibility and publish time) and `ticket_validations` (Looks good / rework)
- Support: `notifications` (inbox + audit), `workspace_settings`, `project_integrations`, `github_activity`

## Attachments and the client Assistant

- **Files:** uploaded to `/api/attachments`, stored on local disk (`storage/uploads`, gitignored) for the MVP. Text is extracted (unpdf, mammoth, exceljs); screenshots are passed as images to the OpenAI provider. AI writes a one-line "AI reviewed your attachment" summary at upload. Downloads are served with a sandboxing Content-Security-Policy.
- **Understanding:** on *Continue*, the description, details and file excerpts go to one structured AI task (summary, goal, workaround, impact, terms). The customer's corrections drive matching and become the evidence text.
- **Assistant:** a server action builds a per-customer context (own requests, supported Needs, public Need fields, approved updates, own files, plus Needs related to the question by vector search) and asks a structured AI task for `{answer, links}`. Links outside that context are dropped. Nothing is persisted and nothing is submitted from the Assistant.

## Delivery tracking and customer validation

- **Public statuses:** each project status maps to Planned / In Development / Ready for Review / Released by its stage (`src/domain/tracking.ts`); the PM marks In-progress statuses as Ready for Review. Backlog tickets are not shown to customers.
- **Timeline:** `ticket_events` records every status move, update and validation with a visibility (`internal` / `customer`). A status move is customer-visible only when the public status changes. Customer pages and My Activity read only customer-visible events, only for tickets in the customer's own company's projects on Needs they follow.
- **Validation:** after Released, `ticket_validations` stores Looks good or a rework request (customer-confirmed AI context, files linked by `validation_id`). The PM or a staffed engineer reopens (ticket back to the first In-progress status, with a customer-visible note) or declines with a reason. Customers never change ticket status.

## Notifications

`src/domain/notifications.ts`: one `notify(event)` call per important action, made by the domain service that performed it (no event bus). Recipients come from relationships, never from hardcoded addresses:

| Event | Recipients |
|---|---|
| New request needing triage | The client account's responsible PM (or every PM) |
| Need update approved | Supporters and client requesters of the Need, staffed engineers |
| Ticket created / assigned / priority | Assignee; PM / Need owner |
| Ticket status change | PM / Need owner and assignee; customers of that client following the Need only when the public status changes (and the Admin's toggle allows it) |
| Engineer customer-visible update | PM to approve; customers once published |
| Rework submitted / decided | Assignee and PM / customer and assignee |
| Need owner, project staffing | The new owner / newly staffed engineers |
| Jira linked or blocked, PR linked | Assignee and PM (no per-commit noise) |

Each recipient gets an in-app row and an email (Mailpit locally) according to their two preferences; assignment and rework always reach the inbox. Every attempt is stored (event, entity, recipient, channel, status, sent time, error). Actors are never notified about their own actions; deactivated users never are.

## Optional integrations

Per project, configured by the Admin or PM (`src/domain/integrations.ts`, clients in `src/integrations/`). Without them, tickets live in Needs Hub only.

- **Jira** behind a `TicketConnector` interface: `LocalTicketConnector` (default, no external system) or `JiraTicketConnector` (Jira Cloud REST v3: create issue, read status and assignee). The ticket stores the issue key, URL, status, assignee and last sync. Needs Hub status stays the source of truth for customers; Jira status is shown to the team only.
- **GitHub**: *Sync now* reads recent commits, PRs and branches per repository and links any item whose message, branch or title mentions a ticket key (local `T-107` or Jira `CARR-184`).
- Tokens are encrypted (AES-256-GCM, key derived from `BETTER_AUTH_SECRET`) and never returned to the browser. An offline demo mode keeps the seeded demo self-contained. No webhooks.
- Customers never see Jira or GitHub data: customer queries read only public statuses and published customer-visible events.

## Authentication

- **Better Auth** (`src/lib/auth.ts`) with sessions in Postgres (`auth_sessions`, `auth_accounts`, `auth_verifications`) via the Drizzle adapter. Better Auth's user model is the app's `users` table; `role` and `accountId` are server-owned fields.
- **Sign-in:** magic link (sent through the same SMTP/Mailpit mailer) and optional Google OAuth (callback `/api/auth/callback/google`), linked to the existing user with the same email.
- **Invitation-only onboarding:** the Admin creates an invitation (email, role, client account). Better Auth's user-create hook copies role and account from the pending invitation and rejects anyone else; magic links are only emailed to existing or invited addresses.
- **Authorization stays in the app:** every page, server action and API route resolves the actor through `src/domain/session.ts` and applies the domain permission rules. Better Auth only answers "who is this?".

## Permissions

Enforced server-side (`src/domain/permissions.ts`), never only in the UI:

- Engineers see client details, evidence, tickets and GitHub activity only for accounts they are staffed on (staffing is Engineer → Account → Project); other clients appear as counts. No contract value.
- Engineers move only their own tickets; Backlog → Planned is a PM decision. Tickets can only be assigned to active engineers staffed on that client.
- Engineers' customer-visible updates reach customers only after the PM publishes them.
- Client users see only public Need fields, their own company's tickets on Needs they follow (public status, published customer-visible updates) and their own requests and files.
- The Admin manages users, accounts, projects, staffing, strategic goals and settings, and is read-only on product decisions. Deactivated users are signed out and can't sign in.

## Local setup

- Docker Compose runs Postgres (pgvector) and Mailpit only; the app runs on the host with `next dev`.
- `.env.example` documents every variable; `AI_PROVIDER=mock` needs no API key.
- `make run` (from a fresh clone, after optional `cp .env.example .env`) checks prerequisites, generates `BETTER_AUTH_SECRET`, installs dependencies, starts the containers, migrates, seeds and starts the app on the first free port from 3000. `make health`, `make test`, `make check` verify it.

## Code map

```
src/app/            App Router: one area per role (client/, pm/, engineer/, admin/), shared server actions (actions/), API routes (api/)
src/components/     shell, share flow, timelines, rework, integrations, inbox
src/domain/         session + permissions, feedback/matching/triage, needs/decisions, delivery/workflow/tracking/validation,
                    notifications, settings, admin/invitations, integrations, attachments, assistant
src/integrations/   Jira and GitHub clients behind the connector types (types.ts)
src/ai/             LanguageModel / EmbeddingProvider interfaces, OpenAI and mock providers
src/db/             Drizzle schema, client, seed; migrations in drizzle/
tests/              unit/ (no database) and integration/ (Postgres + pgvector + Mailpit)
evals/, scripts/    matching evaluation dataset and harness (npm run eval:matching)
```

## Tradeoffs

- **One AI vendor:** one API key, simpler local setup, one SDK and one provider to manage, embeddings and generation from the same vendor. In exchange, an OpenAI outage affects matching and drafting together (mitigated by the matching timeout → Triage fallback), and changing the embedding model means re-embedding.
- **No worker:** the PM waits a few seconds when opening a changed Need or saving a decision. Acceptable at demo scale with loading states and caching.
- **No delivery guarantees:** if the process dies mid-send, some emails go out and some don't, with no retry. Fine against Mailpit, not for production.
- **AI calls inside requests:** latency depends on OpenAI; the submit path has a timeout and fallback, PM screens show an error with "Try again".
- **Minimal AI audit trail:** citations and generation time only; no prompt/version logs.
- **Mock vs real AI:** reproducible, free demos against prompt-quality blind spots; record fixtures from the real provider to close the gap.
- **Exact vector search, no index:** exact results and simplicity at MVP volume.

## Production path (deferred, in order)

1. Postgres jobs table + separate worker, moving AI work, notification email and integration syncs out of the request path.
2. Idempotent, retried email sending through a production provider (notification rows already record each attempt).
3. An `ai_runs` log for prompt/version debugging.
4. Deployment and scaling (HNSW index when vector volume grows).

None of these require redesign: domain services stay the same, only what triggers them changes.
