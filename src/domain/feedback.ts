import { and, eq, sql } from "drizzle-orm";
import { getAi } from "@/ai";
import { getDb } from "@/db/client";
import { accounts, needs, projects, requests, supports, users } from "@/db/schema";
import { linkAttachments, ownedAttachments, toView, type AttachmentView } from "./attachments";
import { getEnv } from "@/lib/env";
import {
  DRAFT_NEED, DRAFT_NEED_INSTRUCTIONS, DraftNeed, FOLLOW_UP, FOLLOW_UP_INSTRUCTIONS, FollowUp,
  REFINE_NEED, REFINE_NEED_INSTRUCTIONS, RefinedNeed, UNDERSTAND_FEEDBACK, UNDERSTAND_FEEDBACK_INSTRUCTIONS, Understanding,
} from "./ai-tasks";
import { matchRequest } from "./matching";
import { accountPms, notify } from "./notifications";
import type { Actor } from "./permissions";

// Feature Request intake: follow-up question -> synchronous match -> support or triage.

export interface FeedbackInput {
  title: string;
  why: string;
}

export interface MatchView {
  relation: "same" | "related" | "new" | "triage";
  needId: string | null;
  confidence: number;
  reason: string;
  need: { id: string; title: string; problemStatement: string; status: string; supporters: number } | null;
}

export type CheckResult = { kind: "follow_up"; question: string } | { kind: "match"; match: MatchView };

/** Step 1: ask one follow-up if the "why" is missing, otherwise find the matching Customer Need. */
export async function checkFeedback(input: FeedbackInput, opts: { skipFollowUp?: boolean } = {}): Promise<CheckResult> {
  const { llm } = getAi();
  if (!opts.skipFollowUp && input.why.trim().length < 20) {
    try {
      const followUp = await llm.generateStructured({ name: FOLLOW_UP, instructions: FOLLOW_UP_INSTRUCTIONS, input, schema: FollowUp });
      if (followUp.needed && followUp.question) return { kind: "follow_up", question: followUp.question };
    } catch {
      // If the follow-up fails, just match on what we have.
    }
  }
  const result = await matchRequest(input, { db: getDb(), ai: getAi(), timeoutMs: getEnv().MATCH_TIMEOUT_MS });
  let need: MatchView["need"] = null;
  if (result.needId && (result.relation === "same" || result.relation === "related")) {
    const [row] = await getDb()
      .select({
        id: needs.id, title: needs.title, problemStatement: needs.problemStatement, status: needs.status,
        supporters: sql<number>`(SELECT count(*)::int FROM supports s WHERE s.need_id = ${needs.id})`,
      })
      .from(needs).where(eq(needs.id, result.needId));
    need = row ?? null;
  }
  return {
    kind: "match",
    match: { relation: need ? result.relation : result.relation === "triage" ? "triage" : "new", needId: need?.id ?? null, confidence: result.confidence, reason: result.reason, need },
  };
}

// ---------- client intake with files: understand -> customer confirms -> match ----------

export interface ConfirmedContext {
  summary: string;
  goal: string;
  workaround: string;
  impact: string;
  terms: string[];
}

/** The customer's own words for the problem, used for matching and as evidence. */
export function contextToWhy(ctx: ConfirmedContext): string {
  return [ctx.goal, ctx.workaround && `Today: ${ctx.workaround}`, ctx.impact && `Impact: ${ctx.impact}`]
    .filter(Boolean).map((s) => s.trim().replace(/([^.!?])$/, "$1.")).join(" ");
}

/** AI reads the description, details and attachments together and proposes the underlying problem. */
export async function understandFeedback(actor: Actor, input: { title: string; details: string; attachmentIds: string[] }): Promise<{ understanding: Understanding; attachments: AttachmentView[] }> {
  const files = await ownedAttachments(actor, input.attachmentIds, { unlinkedOnly: true });
  if (!input.title.trim() && !input.details.trim() && !files.length) throw new Error("Describe what you need or attach a file.");
  const views = files.map(toView);
  const understanding = await getAi().llm.generateStructured({
    name: UNDERSTAND_FEEDBACK, instructions: UNDERSTAND_FEEDBACK_INSTRUCTIONS, schema: Understanding,
    input: {
      title: input.title.trim(), details: input.details.trim(),
      attachments: files.map((f, i) => ({ filename: f.filename, kind: f.kind, summary: views[i].summary ?? "", excerpt: (f.extractedText ?? "").slice(0, 3000) })),
    },
  });
  return { understanding, attachments: views };
}

export interface SubmitInput extends FeedbackInput {
  /** "support": the submitter confirmed the AI match. "different": send to PM triage. */
  choice: "support" | "different";
  needId: string | null;
  relation: MatchView["relation"];
  confidence: number;
  reason: string;
  accountId?: string; // engineers: the client the feedback is for
  projectId?: string; // engineers: the engagement
  context?: ConfirmedContext; // clients: the AI understanding they confirmed or corrected
  attachmentIds?: string[];
}

export interface SubmitOutcome {
  requestId: string;
  outcome: "attached" | "triage";
  needId: string | null;
}

/** Step 2: save the Feature Request. Confirmed matches attach directly; everything else goes to PM Triage. */
export async function submitFeedback(actor: Actor, input: SubmitInput): Promise<SubmitOutcome> {
  const db = getDb();
  let accountId: string;
  let projectId: string | null = null;
  if (actor.role === "client") {
    if (!actor.accountId) throw new Error("Client user has no account");
    accountId = actor.accountId;
  } else if (actor.role === "engineer" || actor.role === "pm") {
    if (!input.accountId) throw new Error("Choose the client this feedback is for");
    if (actor.role === "engineer" && !actor.staffedAccountIds?.includes(input.accountId)) throw new Error("You can only log feedback for clients you are staffed on");
    accountId = input.accountId;
    if (input.projectId) {
      const [project] = await db.select().from(projects).where(and(eq(projects.id, input.projectId), eq(projects.accountId, accountId)));
      if (!project) throw new Error("That project does not belong to the selected client");
      projectId = project.id;
    }
  } else {
    throw new Error("This role cannot submit feedback");
  }

  // Only accept a Need that exists; never trust the browser blindly.
  let needId: string | null = null;
  if (input.needId) {
    const [need] = await db.select({ id: needs.id }).from(needs).where(eq(needs.id, input.needId));
    needId = need?.id ?? null;
  }
  const confirmed = input.choice === "support" && needId !== null && (input.relation === "same" || input.relation === "related");

  // Clients confirm an AI understanding; their corrected words become the evidence text.
  const why = (input.context && contextToWhy(input.context)) || input.why;
  const [embedding] = await getAi().embeddings.embed([`${input.title}\n${why}`]);
  const [request] = await db.insert(requests).values({
    title: input.title.trim(),
    why: why.trim(),
    accountId,
    projectId,
    submittedBy: actor.id,
    onBehalf: actor.role !== "client",
    needId, // for triage this is the AI's suggestion, shown to the PM; only confirmed links count as evidence
    linkType: confirmed ? (input.relation as "same" | "related") : input.relation === "related" || input.relation === "same" ? input.relation : "new",
    linkConfidence: input.confidence,
    linkReason: input.choice === "different" ? `Submitter said it is different. AI: ${input.reason}` : input.reason,
    linkState: confirmed ? "confirmed" : "triage",
    aiContext: input.context ?? null,
    embedding,
  }).returning({ id: requests.id });
  await linkAttachments(actor, input.attachmentIds ?? [], request.id);

  if (confirmed && needId) {
    if (actor.role === "client") await addSupport(actor.id, needId);
    await refineNeedStatement(needId);
    return { requestId: request.id, outcome: "attached", needId };
  }
  // Genuinely new (or uncertain) requests need a PM: tell the client's responsible PM.
  const [who] = await db.select({ name: users.name, account: accounts.name }).from(users).innerJoin(accounts, eq(accounts.id, accountId)).where(eq(users.id, actor.id));
  const interpretation = input.context?.summary || input.reason;
  await notify({
    event: "request.new", entity: { type: "request", id: request.id }, actorId: actor.id, recipients: await accountPms(accountId),
    title: `New request from ${who.account}: ${input.title.trim()}`,
    body: `${who.name} (${who.account}) submitted a request that needs triage.\n\nRequest: ${input.title.trim()}\n${why.trim() ? `Why: ${why.trim()}\n` : ""}AI interpretation: ${interpretation}`,
    href: () => "/pm/triage",
  });
  return { requestId: request.id, outcome: "triage", needId: null };
}

export async function addSupport(userId: string, needId: string) {
  await getDb().insert(supports).values({ userId, needId }).onConflictDoNothing();
}

export async function removeSupport(userId: string, needId: string) {
  await getDb().delete(supports).where(and(eq(supports.userId, userId), eq(supports.needId, needId)));
}

/** Inline refinement after new evidence is attached; failures never block the submitter. */
export async function refineNeedStatement(needId: string): Promise<void> {
  const db = getDb();
  try {
    const [need] = await db.select().from(needs).where(eq(needs.id, needId));
    if (!need) return;
    const evidence = await db.select({ title: requests.title, why: requests.why }).from(requests)
      .where(and(eq(requests.needId, needId), eq(requests.linkState, "confirmed"))).limit(8);
    const { llm, embeddings } = getAi();
    const refined = await llm.generateStructured({
      name: REFINE_NEED, instructions: REFINE_NEED_INSTRUCTIONS, schema: RefinedNeed,
      input: { title: need.title, current: need.problemStatement, evidence },
    });
    const statement = refined.problemStatement.trim();
    if (!statement || statement === need.problemStatement) return;
    const [embedding] = await embeddings.embed([`${need.title}\n${statement}`]);
    await db.update(needs).set({ problemStatement: statement, embedding }).where(eq(needs.id, needId));
  } catch (error) {
    console.warn(`Need refinement skipped: ${(error as Error).message}`);
  }
}

/** Triage: turn a Feature Request into a new Customer Need (AI drafts title + statement). */
export async function createNeedFromRequest(requestId: string): Promise<string> {
  const db = getDb();
  const [request] = await db.select().from(requests).where(eq(requests.id, requestId));
  if (!request) throw new Error("Feature Request not found");
  const { llm, embeddings } = getAi();
  const draft = await llm.generateStructured({
    name: DRAFT_NEED, instructions: DRAFT_NEED_INSTRUCTIONS, schema: DraftNeed,
    input: { title: request.title, why: request.why },
  });
  const [embedding] = await embeddings.embed([`${draft.title}\n${draft.problemStatement}`]);
  const [need] = await db.insert(needs).values({ title: draft.title, problemStatement: draft.problemStatement, embedding }).returning({ id: needs.id });
  await attachRequest(requestId, need.id, "same");
  return need.id;
}

/** Triage: confirm a Feature Request as evidence for a Need. Client submitters become supporters. */
export async function attachRequest(requestId: string, needId: string, linkType: "same" | "related") {
  const db = getDb();
  const [request] = await db
    .update(requests)
    .set({ needId, linkType, linkState: "confirmed" })
    .where(eq(requests.id, requestId))
    .returning({ submittedBy: requests.submittedBy });
  if (!request) throw new Error("Feature Request not found");
  const [submitter] = await db.select({ role: users.role }).from(users).where(eq(users.id, request.submittedBy));
  if (submitter?.role === "client") await addSupport(request.submittedBy, needId);
  await refineNeedStatement(needId);
}
