import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getAi } from "@/ai";
import { getDb } from "@/db/client";
import { accounts, decisions, needs, requests, staffing, statusUpdates, strategicGoals, supports, users } from "@/db/schema";
import { sendEmail } from "@/lib/mailer";
import {
  AI_BRIEF, AI_BRIEF_INSTRUCTIONS, AiBrief, DRAFT_UPDATE, DRAFT_UPDATE_INSTRUCTIONS, DraftUpdate,
  RUBRIC, RUBRIC_INSTRUCTIONS, Rubric,
} from "./ai-tasks";
import { NEED_STATUS } from "./labels";
import { needEvidence, needSignals } from "./needs";
import { canDecideOnNeed, type Actor } from "./permissions";

type NeedStatus = "under_review" | "planned" | "in_development" | "released" | "not_planned";

// ---------- AI Brief + rubric: generated on demand, cached until evidence changes ----------

export interface NeedInsights {
  brief: AiBrief;
  rubric: Rubric;
  generatedAt: Date;
  evidenceCount: number;
}

export async function ensureNeedInsights(needId: string, actor: Actor, opts: { force?: boolean } = {}): Promise<NeedInsights> {
  const db = getDb();
  const [need] = await db.select().from(needs).where(eq(needs.id, needId));
  if (!need) throw new Error("Customer Need not found");
  const { all: evidence } = await needEvidence(needId, actor);
  const fresh = !opts.force && need.aiBrief && need.rubricAi && need.aiEvidenceCount === evidence.length && need.aiGeneratedAt;
  if (fresh) {
    return { brief: need.aiBrief as AiBrief, rubric: need.rubricAi as Rubric, generatedAt: need.aiGeneratedAt!, evidenceCount: evidence.length };
  }

  const signals = (await needSignals([needId])).get(needId)!;
  const goals = await db.select({ code: strategicGoals.code, text: strategicGoals.text }).from(strategicGoals);
  const evidenceInput = evidence.map((e) => ({ id: e.id, account: e.accountName, title: e.title, why: e.why }));
  const input = {
    need: { title: need.title, problemStatement: need.problemStatement },
    evidence: evidenceInput,
    signals: { requests: signals.requests, supporters: signals.supporters, accounts: signals.accounts, enterpriseAccounts: signals.enterpriseAccounts, contractValue: signals.contractValue, trendPct: signals.trendPct },
    goals,
  };
  const { llm } = getAi();
  const [brief, rubric] = await Promise.all([
    llm.generateStructured({ name: AI_BRIEF, instructions: AI_BRIEF_INSTRUCTIONS, input, schema: AiBrief }),
    llm.generateStructured({ name: RUBRIC, instructions: RUBRIC_INSTRUCTIONS, input, schema: Rubric }),
  ]);

  // Citations must point at real evidence for this Need.
  const valid = new Set(evidence.map((e) => e.id));
  const cleanBrief: AiBrief = { ...brief, keyPoints: brief.keyPoints.map((k) => ({ ...k, citations: k.citations.filter((c) => valid.has(c)) })) };
  const cleanRubric: Rubric = {
    ...rubric,
    criteria: rubric.criteria.map((c) => ({ ...c, score: Math.max(1, Math.min(5, c.score)), citations: c.citations.filter((id) => valid.has(id)) })),
  };
  const generatedAt = new Date();
  await db.update(needs).set({ aiBrief: cleanBrief, rubricAi: cleanRubric, aiEvidenceCount: evidence.length, aiGeneratedAt: generatedAt }).where(eq(needs.id, needId));
  return { brief: cleanBrief, rubric: cleanRubric, generatedAt, evidenceCount: evidence.length };
}

// ---------- PM decision ----------

export const DECISION_STATUS: Record<"plan" | "defer" | "more_info" | "not_planned", NeedStatus> = {
  plan: "planned",
  defer: "under_review",
  more_info: "under_review",
  not_planned: "not_planned",
};

export interface DecisionInput {
  decision: keyof typeof DECISION_STATUS;
  priority: "P0" | "P1" | "P2" | "P3" | null;
  rationale: string;
  rubricFinal: Record<string, number>;
}

/** Saves the PM's decision and, when the public status changes, drafts an update for approval. */
export async function saveDecision(actor: Actor, needId: string, input: DecisionInput): Promise<{ updateId: string | null }> {
  if (!canDecideOnNeed(actor)) throw new Error("Only the Product Manager can decide on a Customer Need");
  const rationale = input.rationale.trim();
  if (!rationale) throw new Error("Add a rationale before saving. Customers see it next to the decision.");
  const db = getDb();
  const [need] = await db.select().from(needs).where(eq(needs.id, needId));
  if (!need) throw new Error("Customer Need not found");
  const status = DECISION_STATUS[input.decision];

  await db.insert(decisions).values({ needId, decision: input.decision, priority: input.priority, rationale, decidedBy: actor.id });
  await db.update(needs).set({ status, priority: input.priority, publicRationale: rationale, rubricFinal: input.rubricFinal }).where(eq(needs.id, needId));

  if (status === need.status) return { updateId: null };
  const updateId = await draftStatusUpdate(needId, status, rationale);
  return { updateId };
}

/** AI drafts a customer update; nothing is sent until the PM approves it. */
export async function draftStatusUpdate(needId: string, status: NeedStatus, rationale: string): Promise<string> {
  const db = getDb();
  const [need] = await db.select().from(needs).where(eq(needs.id, needId));
  const statusLabel = NEED_STATUS[status].label;
  const draft = await getAi().llm.generateStructured({
    name: DRAFT_UPDATE, instructions: DRAFT_UPDATE_INSTRUCTIONS, schema: DraftUpdate,
    input: { need: { title: need.title, problemStatement: need.problemStatement }, statusLabel, rationale },
  });
  // One open draft per Need: replace an unapproved one instead of piling up.
  await db.delete(statusUpdates).where(and(eq(statusUpdates.needId, needId), isNull(statusUpdates.approvedBy)));
  const [row] = await db.insert(statusUpdates).values({ needId, status, subject: draft.subject, body: draft.body }).returning({ id: statusUpdates.id });
  return row.id;
}

// ---------- stakeholder updates ----------

export async function listUpdates() {
  const db = getDb();
  const rows = await db
    .select({ id: statusUpdates.id, needId: statusUpdates.needId, needTitle: needs.title, status: statusUpdates.status, subject: statusUpdates.subject, body: statusUpdates.body, approvedBy: statusUpdates.approvedBy, sentAt: statusUpdates.sentAt, createdAt: statusUpdates.createdAt })
    .from(statusUpdates).innerJoin(needs, eq(needs.id, statusUpdates.needId)).orderBy(desc(statusUpdates.createdAt));
  return { drafts: rows.filter((r) => !r.approvedBy), sent: rows.filter((r) => r.approvedBy) };
}

/** Who hears about a Need: client requesters and supporters, plus engineers staffed on affected clients. */
export async function updateRecipients(needId: string) {
  const db = getDb();
  const supporterRows = await db.select({ email: users.email, name: users.name }).from(supports).innerJoin(users, eq(users.id, supports.userId)).where(eq(supports.needId, needId));
  const requesterRows = await db.select({ email: users.email, name: users.name }).from(requests).innerJoin(users, eq(users.id, requests.submittedBy))
    .where(and(eq(requests.needId, needId), eq(requests.linkState, "confirmed"), eq(users.role, "client")));
  const accountIds = (await db.selectDistinct({ id: requests.accountId }).from(requests).where(and(eq(requests.needId, needId), eq(requests.linkState, "confirmed")))).map((r) => r.id);
  const engineerRows = accountIds.length
    ? await db.selectDistinct({ email: users.email, name: users.name }).from(staffing).innerJoin(users, eq(users.id, staffing.engineerId)).where(inArray(staffing.accountId, accountIds))
    : [];
  const byEmail = new Map<string, { email: string; name: string; kind: "customer" | "engineer" }>();
  for (const r of [...supporterRows, ...requesterRows]) byEmail.set(r.email, { ...r, kind: "customer" });
  for (const r of engineerRows) if (!byEmail.has(r.email)) byEmail.set(r.email, { ...r, kind: "engineer" });
  return [...byEmail.values()];
}

export interface SendResult {
  sent: number;
  failed: { email: string; error: string }[];
}

/** PM approves (optionally edited) update; emails go out now, one per recipient. No retries in the MVP. */
export async function approveAndSend(actor: Actor, updateId: string, edit: { subject: string; body: string }): Promise<SendResult> {
  if (!canDecideOnNeed(actor)) throw new Error("Only the Product Manager can approve updates");
  const db = getDb();
  const [update] = await db.select().from(statusUpdates).where(eq(statusUpdates.id, updateId));
  if (!update) throw new Error("Update not found");
  if (update.approvedBy) throw new Error("This update was already sent");
  const subject = edit.subject.trim() || update.subject;
  const body = edit.body.trim() || update.body;

  const recipients = await updateRecipients(update.needId);
  const failed: SendResult["failed"] = [];
  for (const r of recipients) {
    try {
      await sendEmail({ to: `${r.name} <${r.email}>`, subject, text: body });
    } catch (error) {
      failed.push({ email: r.email, error: (error as Error).message });
    }
  }
  await db.update(statusUpdates).set({ subject, body, approvedBy: actor.id, sentAt: new Date() }).where(eq(statusUpdates.id, updateId));
  return { sent: recipients.length - failed.length, failed };
}

export async function draftCount(): Promise<number> {
  const [row] = await getDb().select({ n: sql<number>`count(*)::int` }).from(statusUpdates).where(isNull(statusUpdates.approvedBy));
  return row.n;
}

export async function recipientSummary(needId: string) {
  const r = await updateRecipients(needId);
  return { customers: r.filter((x) => x.kind === "customer").length, engineers: r.filter((x) => x.kind === "engineer").length };
}

export async function accountNames(ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = await getDb().select({ id: accounts.id, name: accounts.name }).from(accounts).where(inArray(accounts.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}
