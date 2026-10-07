import { and, asc, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { getDb } from "@/db/client";
import { needs, projects, projectStatuses, requests, statusUpdates, supports, ticketEvents, tickets, ticketValidations, users } from "@/db/schema";
import { hrefs, notify, ticketPeople } from "./notifications";
import { canViewAccountEvidence, type Actor } from "./permissions";

// Customer-facing delivery tracking. Customers never see internal status names, estimates,
// assignees, projects of other clients or internal comments: only public statuses and
// updates the team explicitly shared with them.

export type PublicStatus = "planned" | "in_development" | "ready_for_review" | "released";
type Stage = "backlog" | "planned" | "in_progress" | "done";

export const PUBLIC_STATUS: Record<PublicStatus, { label: string; chip: string; stage: Stage }> = {
  planned: { label: "Planned", chip: "st-planned", stage: "planned" },
  in_development: { label: "In Development", chip: "st-dev", stage: "in_progress" },
  ready_for_review: { label: "Ready for Review", chip: "st-dev", stage: "in_progress" },
  released: { label: "Released", chip: "st-released", stage: "done" },
};
export const PUBLIC_ORDER: PublicStatus[] = ["planned", "in_development", "ready_for_review", "released"];

/** The status a customer sees; null while the ticket is in Backlog (not shown). */
export function publicStatusOf(status: { stage: Stage; publicStatus: PublicStatus | null }): PublicStatus | null {
  if (status.stage === "backlog") return null;
  if (status.stage === "planned") return "planned";
  if (status.stage === "done") return "released";
  return status.publicStatus === "ready_for_review" ? "ready_for_review" : "in_development";
}

type Db = ReturnType<typeof getDb>;

/** Logs a status move. It's customer-visible only when the public status actually changes. */
export async function recordStatusChange(db: Db, input: {
  ticketId: string; actorId: string;
  from: { name: string; stage: Stage; publicStatus: PublicStatus | null };
  to: { name: string; stage: Stage; publicStatus: PublicStatus | null };
  note?: string;
}) {
  const before = publicStatusOf(input.from);
  const after = publicStatusOf(input.to);
  await db.insert(ticketEvents).values({
    ticketId: input.ticketId, kind: "status", authorId: input.actorId, body: input.note ?? null,
    fromStatus: input.from.name, toStatus: input.to.name, publicStatus: after,
    visibility: after && after !== before ? "customer" : "internal",
    publishedAt: after && after !== before ? new Date() : null,
  });
}

// ---------- team side (PM + engineers) ----------

async function ticketAccount(ticketId: string) {
  const [row] = await getDb().select({ accountId: projects.accountId }).from(tickets).innerJoin(projects, eq(projects.id, tickets.projectId)).where(eq(tickets.id, ticketId));
  return row?.accountId ?? null;
}

export async function canCollaborate(actor: Actor, ticketId: string): Promise<boolean> {
  if (actor.role === "pm") return true;
  if (actor.role !== "engineer") return false;
  const accountId = await ticketAccount(ticketId);
  return Boolean(accountId && canViewAccountEvidence(actor, accountId));
}

/**
 * Team update on a ticket. Internal by default. Customer-visible updates from the PM are
 * published at once; an engineer's wait for the PM to approve them, so customers only ever
 * read updates the PM has signed off.
 */
export async function addComment(actor: Actor, ticketId: string, body: string, visibility: "internal" | "customer") {
  if (!(await canCollaborate(actor, ticketId))) throw new Error("Only the PM and engineers on this client can comment");
  const text = body.trim();
  if (!text) throw new Error("Write an update first");
  if (text.length > 2000) throw new Error("Keep updates under 2000 characters");
  const publishNow = visibility === "customer" && actor.role === "pm";
  await getDb().insert(ticketEvents).values({
    ticketId, kind: "comment", visibility, authorId: actor.id, body: text,
    publishedAt: publishNow ? new Date() : null, publishedBy: publishNow ? actor.id : null,
  });
  if (visibility !== "customer") return;
  const people = await ticketPeople(ticketId);
  if (publishNow) {
    await notify({ event: "ticket.update_published", entity: { type: "ticket", id: ticketId }, actorId: actor.id, recipients: people.customers,
      title: `Update on ${people.title}`, body: text, href: hrefs.ticket(ticketId) });
  } else {
    await notify({ event: "ticket.update_pending", entity: { type: "ticket", id: ticketId }, actorId: actor.id, recipients: people.pms,
      title: `${people.key}: customer update waiting for approval`, body: `An engineer wrote a customer-visible update on ${people.key} ${people.title}:\n\n${text}`, href: hrefs.ticket(ticketId) });
  }
}

/** PM approves an engineer's customer-visible update; customers following the ticket are told. */
export async function publishUpdate(actor: Actor, eventId: string) {
  if (actor.role !== "pm") throw new Error("Only the Product Manager publishes customer updates");
  const db = getDb();
  const [event] = await db.select().from(ticketEvents).where(eq(ticketEvents.id, eventId));
  if (!event || event.kind !== "comment" || event.visibility !== "customer") throw new Error("Update not found");
  if (event.publishedAt) throw new Error("This update is already published");
  await db.update(ticketEvents).set({ publishedAt: new Date(), publishedBy: actor.id }).where(eq(ticketEvents.id, eventId));
  const people = await ticketPeople(event.ticketId);
  await notify({ event: "ticket.update_published", entity: { type: "ticket", id: event.ticketId }, actorId: actor.id, recipients: [...people.customers, event.authorId],
    title: `Update on ${people.title}`, body: event.body ?? "", href: hrefs.ticket(event.ticketId) });
}

/** An engineer asks the PM for a decision; logged internally and sent to the owning PM. */
export async function requestPmInput(actor: Actor, ticketId: string, question: string) {
  if (actor.role !== "engineer" || !(await canCollaborate(actor, ticketId))) throw new Error("Only engineers on this client can ask for PM input");
  const text = question.trim();
  if (!text) throw new Error("Write your question first");
  await getDb().insert(ticketEvents).values({ ticketId, kind: "comment", visibility: "internal", authorId: actor.id, body: `PM input requested: ${text}` });
  const people = await ticketPeople(ticketId);
  await notify({ event: "ticket.pm_input", entity: { type: "ticket", id: ticketId }, actorId: actor.id, recipients: people.pms,
    title: `${people.key}: input needed`, body: `A question on ${people.key} ${people.title}:\n\n${text}`, href: hrefs.ticket(ticketId) });
}

/** Full timeline for the team, newest first, with visibility shown on each entry. */
export async function teamTimeline(ticketId: string) {
  return getDb()
    .select({ id: ticketEvents.id, kind: ticketEvents.kind, visibility: ticketEvents.visibility, body: ticketEvents.body, fromStatus: ticketEvents.fromStatus, toStatus: ticketEvents.toStatus, publicStatus: ticketEvents.publicStatus, publishedAt: ticketEvents.publishedAt, author: users.name, createdAt: ticketEvents.createdAt })
    .from(ticketEvents).leftJoin(users, eq(users.id, ticketEvents.authorId))
    .where(eq(ticketEvents.ticketId, ticketId)).orderBy(desc(ticketEvents.createdAt));
}

// ---------- customer side ----------

/** Needs a client follows: supported, or their own confirmed requests. */
async function followedNeedIds(actor: Actor): Promise<string[]> {
  const db = getDb();
  const [supported, requested] = await Promise.all([
    db.select({ id: supports.needId }).from(supports).where(eq(supports.userId, actor.id)),
    db.select({ id: requests.needId }).from(requests).where(and(eq(requests.submittedBy, actor.id), eq(requests.linkState, "confirmed"), isNotNull(requests.needId))),
  ]);
  return [...new Set([...supported, ...requested].map((r) => r.id!))];
}

export interface CustomerTicket {
  id: string;
  title: string;
  needId: string;
  needTitle: string;
  publicStatus: PublicStatus;
  lastUpdated: Date;
}

/**
 * Tickets a client may track: linked to a Need they follow, delivered in a project of their
 * own company, and past Backlog. Other clients' delivery is only counted, never described.
 */
export async function customerTickets(actor: Actor, opts: { needId?: string } = {}) {
  if (actor.role !== "client" || !actor.accountId) return { tickets: [] as CustomerTicket[], otherProjects: new Map<string, number>() };
  const followed = await followedNeedIds(actor);
  const needIds = opts.needId ? followed.filter((id) => id === opts.needId) : followed;
  if (!needIds.length) return { tickets: [], otherProjects: new Map<string, number>() };
  const db = getDb();
  const rows = await db
    .select({ id: tickets.id, title: tickets.title, needId: needs.id, needTitle: needs.title, accountId: projects.accountId, stage: projectStatuses.stage, publicStatus: projectStatuses.publicStatus, createdAt: tickets.createdAt })
    .from(tickets)
    .innerJoin(projects, eq(projects.id, tickets.projectId))
    .innerJoin(projectStatuses, eq(projectStatuses.id, tickets.statusId))
    .innerJoin(needs, eq(needs.id, tickets.needId))
    .where(and(inArray(tickets.needId, needIds), ne(projectStatuses.stage, "backlog")));
  const own = rows.filter((r) => r.accountId === actor.accountId);
  const otherProjects = new Map<string, number>();
  for (const r of rows.filter((r) => r.accountId !== actor.accountId)) otherProjects.set(r.needId, (otherProjects.get(r.needId) ?? 0) + 1);
  const ids = own.map((r) => r.id);
  const latest = ids.length
    ? await db.select({ ticketId: ticketEvents.ticketId, at: ticketEvents.createdAt }).from(ticketEvents)
      .where(and(inArray(ticketEvents.ticketId, ids), eq(ticketEvents.visibility, "customer"), isNotNull(ticketEvents.publishedAt))).orderBy(desc(ticketEvents.createdAt))
    : [];
  return {
    tickets: own.map((r) => ({
      id: r.id, title: r.title, needId: r.needId, needTitle: r.needTitle,
      publicStatus: publicStatusOf(r)!,
      lastUpdated: latest.find((l) => l.ticketId === r.id)?.at ?? r.createdAt,
    })).sort((a, b) => b.lastUpdated.getTime() - a.lastUpdated.getTime()),
    otherProjects,
  };
}

/** One ticket for a client, with only customer-visible timeline entries; null if not theirs. */
export async function customerTicket(actor: Actor, ticketId: string) {
  const { tickets: mine } = await customerTickets(actor);
  const ticket = mine.find((t) => t.id === ticketId);
  if (!ticket) return null;
  const db = getDb();
  const timeline = await db
    .select({ id: ticketEvents.id, kind: ticketEvents.kind, body: ticketEvents.body, publicStatus: ticketEvents.publicStatus, author: users.name, authorRole: users.role, createdAt: ticketEvents.createdAt })
    .from(ticketEvents).leftJoin(users, eq(users.id, ticketEvents.authorId))
    .where(and(eq(ticketEvents.ticketId, ticketId), eq(ticketEvents.visibility, "customer"), isNotNull(ticketEvents.publishedAt)))
    .orderBy(asc(ticketEvents.createdAt));
  const validations = await db.select().from(ticketValidations)
    .where(and(eq(ticketValidations.ticketId, ticketId), eq(ticketValidations.userId, actor.id)))
    .orderBy(desc(ticketValidations.createdAt));
  return { ticket, timeline, validations };
}

export interface ActivityItem {
  at: Date;
  text: string;
  href: string;
  kind: "status" | "comment" | "update";
}

/** Recent changes the client should notice: ticket status moves, shared comments, approved updates. */
export async function customerActivity(actor: Actor, limit = 12): Promise<ActivityItem[]> {
  if (actor.role !== "client") return [];
  const { tickets: mine } = await customerTickets(actor);
  const db = getDb();
  const items: ActivityItem[] = [];
  if (mine.length) {
    const events = await db.select({ ticketId: ticketEvents.ticketId, kind: ticketEvents.kind, body: ticketEvents.body, publicStatus: ticketEvents.publicStatus, createdAt: ticketEvents.createdAt })
      .from(ticketEvents).where(and(inArray(ticketEvents.ticketId, mine.map((t) => t.id)), eq(ticketEvents.visibility, "customer"), isNotNull(ticketEvents.publishedAt)))
      .orderBy(desc(ticketEvents.createdAt)).limit(limit);
    for (const e of events) {
      const t = mine.find((x) => x.id === e.ticketId)!;
      if (e.kind === "status" && e.publicStatus) items.push({ at: e.createdAt, kind: "status", href: `/client/tickets/${t.id}`, text: `${t.title} moved to ${PUBLIC_STATUS[e.publicStatus].label}.` });
      else if (e.kind === "comment") items.push({ at: e.createdAt, kind: "comment", href: `/client/tickets/${t.id}`, text: `Update on ${t.title}: ${e.body}` });
      else if (e.kind === "validation") items.push({ at: e.createdAt, kind: "comment", href: `/client/tickets/${t.id}`, text: `${t.title}: ${e.body}` });
    }
  }
  const followed = await followedNeedIds(actor);
  if (followed.length) {
    const updates = await db.select({ needId: statusUpdates.needId, subject: statusUpdates.subject, sentAt: statusUpdates.sentAt })
      .from(statusUpdates).where(and(inArray(statusUpdates.needId, followed), isNotNull(statusUpdates.sentAt))).orderBy(desc(statusUpdates.sentAt)).limit(limit);
    for (const u of updates) items.push({ at: u.sentAt!, kind: "update", href: `/client/needs/${u.needId}`, text: u.subject });
  }
  return items.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}
