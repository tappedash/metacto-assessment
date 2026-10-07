import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { getAi } from "@/ai";
import { getDb } from "@/db/client";
import { accounts, decisions, needs, projects, requests, statusUpdates, supports, tickets, users } from "@/db/schema";
import { DRAFT_NEED, DRAFT_NEED_INSTRUCTIONS, DraftNeed } from "./ai-tasks";
import { attachRequest, createNeedFromRequest } from "./feedback";
import { hrefs, notify } from "./notifications";
import { getSettings } from "./settings";
import { canDecideOnNeed, type Actor } from "./permissions";

// PM Triage: only the cases AI could not settle (low confidence, proposed new Needs,
// "this is different" answers, timeouts). Confirmed matches never land here.

export async function listTriage() {
  const db = getDb();
  return db
    .select({
      id: requests.id, title: requests.title, why: requests.why, linkType: requests.linkType, confidence: requests.linkConfidence,
      reason: requests.linkReason, onBehalf: requests.onBehalf, createdAt: requests.createdAt,
      accountName: accounts.name, accountTier: accounts.tier, submittedBy: users.name, submitterRole: users.role,
      suggestedNeedId: needs.id, suggestedNeedTitle: needs.title, projectName: projects.name,
    })
    .from(requests)
    .innerJoin(accounts, eq(accounts.id, requests.accountId))
    .innerJoin(users, eq(users.id, requests.submittedBy))
    .leftJoin(needs, eq(needs.id, requests.needId))
    .leftJoin(projects, eq(projects.id, requests.projectId))
    .where(eq(requests.linkState, "triage"))
    .orderBy(asc(requests.createdAt));
}

export async function triageCount(): Promise<number> {
  const [row] = await getDb().select({ n: sql<number>`count(*)::int` }).from(requests).where(eq(requests.linkState, "triage"));
  return row.n;
}

/** Requests AI matched confidently and the customer confirmed: they never needed the PM. */
export async function autoMatchedCount(days = 30): Promise<number> {
  const { matchThreshold } = await getSettings();
  const [row] = await getDb().select({ n: sql<number>`count(*)::int` }).from(requests)
    .where(and(eq(requests.linkState, "confirmed"), gte(requests.linkConfidence, matchThreshold), gte(requests.createdAt, new Date(Date.now() - days * 86_400_000))));
  return row.n;
}

function assertPm(actor: Actor) {
  if (!canDecideOnNeed(actor)) throw new Error("Only the Product Manager can triage");
}

async function triageRequest(requestId: string) {
  const [request] = await getDb().select().from(requests).where(and(eq(requests.id, requestId), eq(requests.linkState, "triage")));
  if (!request) throw new Error("This item is no longer in Triage");
  return request;
}

/** Accept the AI's suggested Customer Need. */
export async function acceptSuggestion(actor: Actor, requestId: string) {
  assertPm(actor);
  const request = await triageRequest(requestId);
  if (!request.needId) throw new Error("No suggested Customer Need to accept; move it or create a new Need");
  await attachRequest(requestId, request.needId, request.linkType === "same" ? "same" : "related");
}

/** Attach to a different Customer Need chosen by the PM. */
export async function moveToNeed(actor: Actor, requestId: string, needId: string) {
  assertPm(actor);
  await triageRequest(requestId);
  const [need] = await getDb().select({ id: needs.id }).from(needs).where(eq(needs.id, needId));
  if (!need) throw new Error("Customer Need not found");
  await attachRequest(requestId, needId, "related");
}

/** Create a new Customer Need from the request (AI drafts title + problem statement). */
export async function createNeed(actor: Actor, requestId: string) {
  assertPm(actor);
  await triageRequest(requestId);
  return createNeedFromRequest(requestId);
}

/** Merge a duplicate Need into another: evidence, supporters and tickets move; the duplicate is removed. */
export async function mergeNeeds(actor: Actor, sourceId: string, targetId: string) {
  assertPm(actor);
  if (sourceId === targetId) throw new Error("Choose a different Customer Need to merge into");
  const db = getDb();
  await db.transaction(async (tx) => {
    const [target] = await tx.select({ id: needs.id }).from(needs).where(eq(needs.id, targetId));
    if (!target) throw new Error("Target Customer Need not found");
    await tx.update(requests).set({ needId: targetId }).where(eq(requests.needId, sourceId));
    await tx.update(tickets).set({ needId: targetId }).where(eq(tickets.needId, sourceId));
    await tx.execute(sql`INSERT INTO supports (user_id, need_id, created_at)
      SELECT user_id, ${targetId}::uuid, created_at FROM supports WHERE need_id = ${sourceId}::uuid ON CONFLICT DO NOTHING`);
    await tx.delete(supports).where(eq(supports.needId, sourceId));
    await tx.delete(decisions).where(eq(decisions.needId, sourceId));
    await tx.delete(statusUpdates).where(eq(statusUpdates.needId, sourceId));
    await tx.delete(needs).where(eq(needs.id, sourceId));
    // Evidence changed: force the AI Brief and rubric to regenerate.
    await tx.update(needs).set({ aiEvidenceCount: null }).where(eq(needs.id, targetId));
  });
}

/** The PM who owns a Need hears about its new requests, tickets and rework. */
export async function assignNeedOwner(actor: Actor, needId: string, ownerId: string | null) {
  assertPm(actor);
  const db = getDb();
  if (ownerId) {
    const [pm] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, ownerId), eq(users.role, "pm"), eq(users.active, true)));
    if (!pm) throw new Error("The owner must be an active Product Manager");
  }
  const [need] = await db.update(needs).set({ ownerId }).where(eq(needs.id, needId)).returning({ title: needs.title });
  if (!need) throw new Error("Customer Need not found");
  if (ownerId) {
    await notify({ event: "need.assigned", entity: { type: "need", id: needId }, actorId: actor.id, recipients: [ownerId],
      title: `You own "${need.title}"`, body: `You're now the owner of the Customer Need "${need.title}".`, href: hrefs.need(needId) });
  }
}

/**
 * Split: some requests on a Need describe a different problem. They move to a new Need (AI
 * drafts its statement from them); their client submitters support the new Need instead.
 */
export async function splitNeed(actor: Actor, needId: string, requestIds: string[], title: string) {
  assertPm(actor);
  if (!requestIds.length) throw new Error("Choose the requests that describe a different problem");
  const db = getDb();
  const moving = await db.select().from(requests).where(and(eq(requests.needId, needId), eq(requests.linkState, "confirmed"), inArray(requests.id, requestIds)));
  if (moving.length !== requestIds.length) throw new Error("Some of those requests aren't evidence for this Need");
  const [{ remaining }] = await db.select({ remaining: sql<number>`count(*)::int` }).from(requests).where(and(eq(requests.needId, needId), eq(requests.linkState, "confirmed")));
  if (remaining === moving.length) throw new Error("Keep at least one request on this Need; to rename it, edit the Need instead");

  const { llm, embeddings } = getAi();
  const draft = await llm.generateStructured({
    name: DRAFT_NEED, instructions: DRAFT_NEED_INSTRUCTIONS, schema: DraftNeed,
    input: { title: moving.map((r) => r.title).join("; "), why: moving.map((r) => r.why).join(" ") },
  });
  const newTitle = title.trim() || draft.title;
  const [embedding] = await embeddings.embed([`${newTitle}\n${draft.problemStatement}`]);
  const [created] = await db.insert(needs).values({ title: newTitle, problemStatement: draft.problemStatement, embedding, ownerId: actor.id }).returning({ id: needs.id });
  await db.update(requests).set({ needId: created.id }).where(inArray(requests.id, requestIds));

  // Client submitters follow the new Need; they keep supporting the old one only if they still have a request there.
  const submitters = [...new Set(moving.map((r) => r.submittedBy))];
  const clients = (await db.select({ id: users.id }).from(users).where(and(inArray(users.id, submitters), eq(users.role, "client")))).map((u) => u.id);
  for (const userId of clients) {
    await db.insert(supports).values({ userId, needId: created.id }).onConflictDoNothing();
    const [{ left }] = await db.select({ left: sql<number>`count(*)::int` }).from(requests).where(and(eq(requests.needId, needId), eq(requests.submittedBy, userId)));
    if (!left) await db.delete(supports).where(and(eq(supports.needId, needId), eq(supports.userId, userId)));
  }
  // Evidence changed on both: force the AI Brief and rubric to regenerate.
  await db.update(needs).set({ aiEvidenceCount: null }).where(inArray(needs.id, [needId, created.id]));
  return created.id;
}
