import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { accounts, decisions, needs, projects, requests, statusUpdates, supports, tickets, users } from "@/db/schema";
import { attachRequest, createNeedFromRequest } from "./feedback";
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
