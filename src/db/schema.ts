import {
  boolean, integer, jsonb, pgEnum, pgTable, primaryKey, real, text, timestamp, uuid, vector,
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
export const ticketStatus = pgEnum("ticket_status", ["backlog", "planned", "in_development", "released"]);
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
  ...timestamps,
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: userRole("role").notNull(),
  accountId: uuid("account_id").references(() => accounts.id), // client users only
  ...timestamps,
});

// Which accounts an engineer may see (client confidentiality).
export const staffing = pgTable("staffing", {
  engineerId: uuid("engineer_id").notNull().references(() => users.id),
  accountId: uuid("account_id").notNull().references(() => accounts.id),
}, (t) => [primaryKey({ columns: [t.engineerId, t.accountId] })]);

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
  embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
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
  status: ticketStatus("status").notNull().default("backlog"),
  priority: priority("priority"),
  effort: effort("effort"),
  assigneeId: uuid("assignee_id").references(() => users.id),
  feasibility: text("feasibility"),
  dependencies: text("dependencies"),
  notes: text("notes"),
  ...timestamps,
});
