import {
  type AnyPgColumn, boolean, integer, jsonb, pgEnum, pgTable, primaryKey, real, text, timestamp, unique, uuid, vector,
} from "drizzle-orm/pg-core";

// pgvector column size. OpenAI embeddings are requested at this size; changing it
// needs a migration and re-embedding every request and Customer Need.
export const EMBEDDING_DIMENSIONS = 1536;

// ---------- enums ----------
export const accountType = pgEnum("account_type", ["client", "prospect"]);
export const userRole = pgEnum("user_role", ["admin", "pm", "engineer", "client"]);
export const projectStatus = pgEnum("project_status", ["planning", "active", "done"]);
export const needStatus = pgEnum("need_status", ["under_review", "planned", "in_development", "released", "not_planned"]);
export const priority = pgEnum("priority", ["P0", "P1", "P2", "P3"]);
export const linkType = pgEnum("link_type", ["same", "related", "new"]);
export const linkState = pgEnum("link_state", ["confirmed", "triage"]);
// Fixed stages behind each project's configurable ticket statuses. Rules use the stage:
// only the PM moves tickets out of Backlog; engineers move their own tickets through the rest;
// the first ticket In progress moves the Need to In Development, all Done -> Released.
export const statusStage = pgEnum("status_stage", ["backlog", "planned", "in_progress", "done"]);
// What customers see for a ticket. Backlog tickets are never shown to customers.
export const publicTicketStatus = pgEnum("public_ticket_status", ["planned", "in_development", "ready_for_review", "released"]);
export const commentVisibility = pgEnum("comment_visibility", ["internal", "customer"]);
export const ticketEventKind = pgEnum("ticket_event_kind", ["status", "comment", "validation"]);
export const validationVerdict = pgEnum("validation_verdict", ["looks_good", "rework"]);
export const reworkState = pgEnum("rework_state", ["open", "reopened", "follow_up", "declined"]);
export const integrationKind = pgEnum("integration_kind", ["jira", "github"]);
export const githubActivityKind = pgEnum("github_activity_kind", ["commit", "pull_request", "branch"]);
export const notificationChannel = pgEnum("notification_channel", ["in_app", "email"]);
export const notificationStatus = pgEnum("notification_status", ["sent", "failed", "skipped"]);
export const effort = pgEnum("effort", ["S", "M", "L", "XL"]);
export const decisionType = pgEnum("decision_type", ["plan", "defer", "more_info", "not_planned"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
};

// ---------- organisation ----------
export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  type: accountType("type").notNull().default("client"),
  tier: text("tier").notNull(), // Enterprise | Mid-market | ...
  segment: text("segment").notNull(),
  contractValue: integer("contract_value"), // USD; Admin + PM only
  // Responsible PM: hears about new requests from this client. Null = every PM.
  ownerPmId: uuid("owner_pm_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  ...timestamps,
});

// App users, also Better Auth's "user" model (see src/lib/auth.ts). role and accountId are
// set only from an invitation, never by the sign-in request.
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  role: userRole("role").notNull(),
  accountId: uuid("account_id").references(() => accounts.id), // client users only
  active: boolean("active").notNull().default(true), // deactivated users can't sign in or be notified
  notifyEmail: boolean("notify_email").notNull().default(true),
  notifyInApp: boolean("notify_in_app").notNull().default(true),
  ...timestamps,
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- Better Auth (sessions, OAuth/magic-link accounts, verification tokens) ----------
// "auth_accounts" are sign-in methods (e.g. Google), not to be confused with client `accounts`.
export const authSessions = pgTable("auth_sessions", {
  id: uuid("id").primaryKey().defaultRandom(), // Better Auth generateId "uuid" lets Postgres create ids
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const authAccounts = pgTable("auth_accounts", {
  id: uuid("id").primaryKey().defaultRandom(), // Better Auth generateId "uuid" lets Postgres create ids
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(), // provider's user id
  providerId: text("provider_id").notNull(), // "google", ...
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const authVerifications = pgTable("auth_verifications", {
  id: uuid("id").primaryKey().defaultRandom(), // Better Auth generateId "uuid" lets Postgres create ids
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Invitation-based onboarding: the Admin invites email + role (+ client account for client
// users). The first sign-in with that email creates the user from the invitation.
export const invitations = pgTable("invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  role: userRole("role").notNull(),
  accountId: uuid("account_id").references(() => accounts.id),
  invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  ...timestamps,
});

// Which accounts an engineer may see (client confidentiality).
export const staffing = pgTable("staffing", {
  engineerId: uuid("engineer_id").notNull().references(() => users.id),
  accountId: uuid("account_id").notNull().references(() => accounts.id),
}, (t) => [primaryKey({ columns: [t.engineerId, t.accountId] })]);

// Workspace defaults the Admin can change. One row (id = 1); deliberately small.
export const workspaceSettings = pgTable("workspace_settings", {
  id: integer("id").primaryKey().default(1),
  // AI matches below this confidence aren't shown to the customer; the request goes to PM Triage.
  matchThreshold: real("match_threshold").notNull().default(0.6),
  // Which delivery events customers are told about: { planned, in_development, ready_for_review, released, rework_decision }.
  customerNotify: jsonb("customer_notify").notNull(),
  // Preferences new users start with.
  defaultNotifyEmail: boolean("default_notify_email").notNull().default(true),
  defaultNotifyInApp: boolean("default_notify_in_app").notNull().default(true),
});

export const strategicGoals = pgTable("strategic_goals", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(), // G1, G2, ...
  text: text("text").notNull(),
});

// ---------- product intelligence: Feature Request -> Customer Need ----------
export const needs = pgTable("needs", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  problemStatement: text("problem_statement").notNull(),
  status: needStatus("status").notNull().default("under_review"),
  priority: priority("priority"),
  publicRationale: text("public_rationale"),
  embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
  // On-demand AI output, cached until evidence changes (cites request IDs).
  aiBrief: jsonb("ai_brief"),
  rubricAi: jsonb("rubric_ai"),
  rubricFinal: jsonb("rubric_final"),
  aiEvidenceCount: integer("ai_evidence_count"),
  aiGeneratedAt: timestamp("ai_generated_at", { withTimezone: true }),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }), // owning PM
  ...timestamps,
});

export const requests = pgTable("requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  why: text("why").notNull().default(""),
  accountId: uuid("account_id").notNull().references(() => accounts.id),
  projectId: uuid("project_id").references(() => projects.id),
  submittedBy: uuid("submitted_by").notNull().references(() => users.id),
  onBehalf: boolean("on_behalf").notNull().default(false), // counts toward the account, not the engineer
  needId: uuid("need_id").references(() => needs.id),
  linkType: linkType("link_type"),
  linkConfidence: real("link_confidence"),
  linkReason: text("link_reason"),
  linkState: linkState("link_state"),
  // What the customer confirmed after AI read their description and files:
  // { summary, goal, workaround, impact, terms[] }.
  aiContext: jsonb("ai_context"),
  embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
  ...timestamps,
});

// Ticket timeline: status changes and contributor comments. Customers see only events
// marked "customer" (public status changes and comments explicitly shared with them).
export const ticketEvents = pgTable("ticket_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketId: uuid("ticket_id").notNull().references(() => tickets.id, { onDelete: "cascade" }),
  kind: ticketEventKind("kind").notNull(),
  visibility: commentVisibility("visibility").notNull().default("internal"),
  authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
  body: text("body"), // comment text, or validation note
  fromStatus: text("from_status"), // internal status names (team view only)
  toStatus: text("to_status"),
  publicStatus: publicTicketStatus("public_status"), // public status after a status change
  // Customer-visible entries reach customers once published: PM entries and status moves at
  // once, engineers' customer-visible updates after the PM approves them.
  publishedAt: timestamp("published_at", { withTimezone: true }),
  publishedBy: uuid("published_by").references(() => users.id, { onDelete: "set null" }),
  ...timestamps,
});

// Customer validation after release: "Looks good" or a rework request for the team to review.
export const ticketValidations = pgTable("ticket_validations", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketId: uuid("ticket_id").notNull().references(() => tickets.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id),
  verdict: validationVerdict("verdict").notNull(),
  description: text("description"),
  aiContext: jsonb("ai_context"), // { summary, expected, actual, impact } confirmed by the customer
  state: reworkState("state"), // rework only
  resolutionNote: text("resolution_note"), // shown to the customer
  resolvedBy: uuid("resolved_by").references(() => users.id),
  followUpTicketId: uuid("follow_up_ticket_id").references((): AnyPgColumn => tickets.id, { onDelete: "set null" }), // rework accepted as a new ticket
  ...timestamps,
});

// Files customers attach to feedback (or share with the Assistant). Stored on local disk
// for the MVP; only the owner, the PM and engineers staffed on the account can open them.
export const attachments = pgTable("attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => users.id),
  requestId: uuid("request_id").references(() => requests.id, { onDelete: "set null" }),
  validationId: uuid("validation_id").references(() => ticketValidations.id, { onDelete: "set null" }),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  kind: text("kind").notNull(), // pdf | document | spreadsheet | image | text
  sizeBytes: integer("size_bytes").notNull(),
  storagePath: text("storage_path").notNull(),
  extractedText: text("extracted_text"),
  aiSummary: jsonb("ai_summary"), // { summary, terms[] } shown as "AI reviewed your attachment"
  ...timestamps,
});

export const supports = pgTable("supports", {
  userId: uuid("user_id").notNull().references(() => users.id),
  needId: uuid("need_id").notNull().references(() => needs.id),
  ...timestamps,
}, (t) => [primaryKey({ columns: [t.userId, t.needId] })]);

export const decisions = pgTable("decisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  needId: uuid("need_id").notNull().references(() => needs.id),
  decision: decisionType("decision").notNull(),
  priority: priority("priority"),
  rationale: text("rationale").notNull(),
  decidedBy: uuid("decided_by").notNull().references(() => users.id),
  ...timestamps,
});

export const statusUpdates = pgTable("status_updates", {
  id: uuid("id").primaryKey().defaultRandom(),
  needId: uuid("need_id").notNull().references(() => needs.id),
  status: needStatus("status").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  approvedBy: uuid("approved_by").references(() => users.id),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  ...timestamps,
});

// ---------- delivery: Client -> Project -> Ticket ----------
export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull().references(() => accounts.id),
  name: text("name").notNull(),
  status: projectStatus("status").notNull().default("active"),
  ...timestamps,
});

// Per-project ticket statuses, configured by the PM. Ordered by position; stages never go backwards.
export const projectStatuses = pgTable("project_statuses", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  stage: statusStage("stage").notNull(),
  // Customer-facing label; null = derived from the stage (planned / in development / released).
  publicStatus: publicTicketStatus("public_status"),
  position: integer("position").notNull(),
}, (t) => [unique("project_statuses_project_name").on(t.projectId, t.name)]);

export const projectMembers = pgTable("project_members", {
  projectId: uuid("project_id").notNull().references(() => projects.id),
  userId: uuid("user_id").notNull().references(() => users.id),
}, (t) => [primaryKey({ columns: [t.projectId, t.userId] })]);

export const tickets = pgTable("tickets", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(), // T-101
  projectId: uuid("project_id").notNull().references(() => projects.id),
  needId: uuid("need_id").notNull().references(() => needs.id), // "why are we building this?"
  title: text("title").notNull(),
  statusId: uuid("status_id").notNull().references(() => projectStatuses.id),
  priority: priority("priority"),
  effort: effort("effort"),
  assigneeId: uuid("assignee_id").references(() => users.id),
  feasibility: text("feasibility"),
  dependencies: text("dependencies"),
  notes: text("notes"),
  // Optional Jira issue (Project -> Integrations -> Jira). Needs Hub stays the source of the
  // customer context; Jira status and assignee are shown as last synced.
  externalKey: text("external_key"), // PROJ-184
  externalUrl: text("external_url"),
  externalStatus: text("external_status"),
  externalAssignee: text("external_assignee"),
  syncedAt: timestamp("synced_at", { withTimezone: true }),
  ...timestamps,
});

// Optional per-project connectors. config: jira { siteUrl, projectKey, email, issueType, demo }
// or github { repos: ["owner/name"], demo }. The API token is stored encrypted (src/lib/secrets.ts).
export const projectIntegrations = pgTable("project_integrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  kind: integrationKind("kind").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  config: jsonb("config").notNull(),
  secret: text("secret"),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastError: text("last_error"),
  ...timestamps,
}, (t) => [unique("project_integrations_project_kind").on(t.projectId, t.kind)]);

// Engineering activity from connected repositories, linked to a ticket when its key appears in
// a commit message, branch name or PR title. Internal only: customers never see it.
export const githubActivity = pgTable("github_activity", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  ticketId: uuid("ticket_id").references(() => tickets.id, { onDelete: "set null" }),
  kind: githubActivityKind("kind").notNull(),
  repo: text("repo").notNull(), // owner/name
  ref: text("ref").notNull(), // commit sha, PR number or branch name
  title: text("title").notNull(),
  author: text("author"),
  url: text("url").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  ...timestamps,
}, (t) => [unique("github_activity_ref").on(t.projectId, t.kind, t.repo, t.ref)]);

// Notifications: the in-app inbox and the audit trail of every delivery attempt (one row per
// recipient and channel).
export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(), // e.g. ticket.assigned
  entityType: text("entity_type").notNull(), // request | need | ticket | project | rework
  entityId: uuid("entity_id").notNull(),
  channel: notificationChannel("channel").notNull(),
  status: notificationStatus("status").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  href: text("href").notNull(),
  error: text("error"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  readAt: timestamp("read_at", { withTimezone: true }),
  ...timestamps,
});
