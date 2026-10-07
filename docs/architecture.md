# Needs Hub — Architecture (local MVP)

| Field | Value |
|---|---|
| Scope | Local MVP: the simplest architecture that proves the end-to-end workflow |
| Product spec | `product_specs/mvp_spec_20261007-165228.md` (v0.3) |
| AI provider | OpenAI (single vendor), with a deterministic mock for running without a key |

## Goals

Prove this workflow on one developer machine:

**Feature Request → AI understanding → Customer Need → PM decision → Delivery → Stakeholder update**

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
- Delivery: Account (client) → Project → Ticket, with ticket statuses configured per project (each mapped to a fixed stage that the rules use)

## Permissions

Enforced server-side (`src/domain/permissions.ts`), never only in the UI:

- Engineers see client details and evidence only for accounts they are staffed on; other clients appear as counts. No contract value.
- Engineers move only their own tickets, and only Planned → In Development → Released. Backlog → Planned is a PM decision.
- Client users see only public Need fields (problem statement, status, public rationale, supporter count).

## Local setup

- Docker Compose runs Postgres (pgvector) and Mailpit only; the app runs on the host with `next dev`.
- `.env.example` documents every variable; `AI_PROVIDER=mock` needs no API key.
- `npm run setup` starts the containers, runs migrations and seeds demo data.

## Tradeoffs

- **One AI vendor:** one API key, simpler local setup, one SDK and one provider to manage, embeddings and generation from the same vendor. In exchange, an OpenAI outage affects matching and drafting together (mitigated by the matching timeout → Triage fallback), and changing the embedding model means re-embedding.
- **No worker:** the PM waits a few seconds when opening a changed Need or saving a decision. Acceptable at demo scale with loading states and caching.
- **No delivery guarantees:** if the process dies mid-send, some emails go out and some don't, with no retry. Fine against Mailpit, not for production.
- **AI calls inside requests:** latency depends on OpenAI; the submit path has a timeout and fallback, PM screens show an error with "Try again".
- **Minimal AI audit trail:** citations and generation time only; no prompt/version logs.
- **Mock vs real AI:** reproducible, free demos against prompt-quality blind spots; record fixtures from the real provider to close the gap.
- **Exact vector search, no index:** exact results and simplicity at MVP volume.

## Production path (deferred, in order)

1. Postgres jobs table + separate worker, moving AI work and email out of the request path.
2. Idempotent, retried email sending through a production provider.
3. An `ai_runs` log for prompt/version debugging.
4. Deployment and scaling (HNSW index when vector volume grows).

None of these require redesign: domain services stay the same, only what triggers them changes.
