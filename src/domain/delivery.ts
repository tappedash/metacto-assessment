import { and, asc, desc, eq, ilike, inArray, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db/client";
import { accounts, needs, projectMembers, projects, statusUpdates, tickets, users } from "@/db/schema";
import { draftStatusUpdate } from "./decisions";
import { allowedTicketMoves, canViewAccountEvidence, type Actor, type TicketStatus } from "./permissions";

// Delivery layer: Client (account) -> Project -> Ticket. Each ticket links to the
// Customer Need that explains why it is being built.

const ticketColumns = {
  id: tickets.id, key: tickets.key, title: tickets.title, status: tickets.status, priority: tickets.priority, effort: tickets.effort,
  assigneeId: tickets.assigneeId, assignee: users.name, projectId: projects.id, projectName: projects.name,
  accountId: accounts.id, accountName: accounts.name, needId: needs.id, needTitle: needs.title,
  feasibility: tickets.feasibility, dependencies: tickets.dependencies, notes: tickets.notes,
};

function ticketQuery() {
  return getDb()
    .select(ticketColumns)
    .from(tickets)
    .innerJoin(projects, eq(projects.id, tickets.projectId))
    .innerJoin(accounts, eq(accounts.id, projects.accountId))
    .innerJoin(needs, eq(needs.id, tickets.needId))
    .leftJoin(users, eq(users.id, tickets.assigneeId));
}

/** Engineers see tickets only for projects of clients they are staffed on. */
function visibleAccounts(actor: Actor): SQL | undefined {
  if (actor.role === "engineer") {
    const staffed = actor.staffedAccountIds ?? [];
    return staffed.length ? inArray(accounts.id, staffed) : sql`false`;
  }
  return undefined;
}

export interface TicketFilters {
  q?: string;
  projectId?: string;
  accountId?: string;
  priority?: string;
  assigneeId?: string;
}

export async function listTickets(actor: Actor, f: TicketFilters = {}) {
  const conditions = [
    visibleAccounts(actor),
    f.projectId ? eq(projects.id, f.projectId) : undefined,
    f.accountId ? eq(accounts.id, f.accountId) : undefined,
    f.priority ? eq(tickets.priority, f.priority as "P0") : undefined,
    f.assigneeId ? eq(tickets.assigneeId, f.assigneeId) : undefined,
    f.q ? or(ilike(tickets.title, `%${f.q}%`), ilike(tickets.key, `%${f.q}%`), ilike(projects.name, `%${f.q}%`), ilike(accounts.name, `%${f.q}%`)) : undefined,
  ].filter(Boolean) as SQL[];
  return ticketQuery().where(conditions.length ? and(...conditions) : undefined).orderBy(asc(tickets.key));
}

export async function getTicket(actor: Actor, id: string) {
  const [ticket] = await ticketQuery().where(eq(tickets.id, id));
  if (!ticket || (actor.role === "engineer" && !canViewAccountEvidence(actor, ticket.accountId))) return null;
  return ticket;
}

/**
 * Moves a ticket if the actor may. The Customer Need follows delivery:
 * first ticket in development -> Need "In Development"; all tickets released -> Need "Released".
 * Each Need status change drafts a customer update for the PM to approve.
 */
export async function moveTicket(actor: Actor, ticketId: string, to: TicketStatus) {
  const db = getDb();
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
  if (!ticket) throw new Error("Ticket not found");
  if (actor.role === "engineer") {
    const visible = await getTicket(actor, ticketId);
    if (!visible) throw new Error("Ticket not found");
  }
  if (!allowedTicketMoves(actor, { assigneeId: ticket.assigneeId, status: ticket.status }).includes(to)) {
    throw new Error("You can't move this ticket to that status");
  }
  await db.update(tickets).set({ status: to }).where(eq(tickets.id, ticketId));

  const [need] = await db.select().from(needs).where(eq(needs.id, ticket.needId));
  const siblings = await db.select({ status: tickets.status }).from(tickets).where(eq(tickets.needId, ticket.needId));
  let next: "in_development" | "released" | null = null;
  if (to === "in_development" && need.status === "planned") next = "in_development";
  if (to === "released" && siblings.every((s) => s.status === "released") && need.status !== "released") next = "released";
  if (next) {
    await db.update(needs).set({ status: next }).where(eq(needs.id, need.id));
    await draftStatusUpdate(need.id, next, next === "released" ? "All delivery work for this is now released." : "Engineering has started building this.");
  }
  return { needStatusChanged: next };
}

export async function nextTicketKey(): Promise<string> {
  const [row] = await getDb().select({ max: sql<number>`COALESCE(max(substring(key from 3)::int), 100)` }).from(tickets);
  return `T-${Number(row.max) + 1}`;
}

export async function createTicket(actor: Actor, input: { needId: string; projectId: string; title: string; priority: string | null; effort: string | null; assigneeId: string | null }) {
  if (actor.role !== "pm") throw new Error("Only the Product Manager creates tickets");
  if (!input.title.trim()) throw new Error("Give the ticket a title");
  const key = await nextTicketKey();
  const [row] = await getDb().insert(tickets).values({
    key, title: input.title.trim(), needId: input.needId, projectId: input.projectId,
    priority: (input.priority || null) as "P1" | null, effort: (input.effort || null) as "M" | null, assigneeId: input.assigneeId || null,
  }).returning({ id: tickets.id, key: tickets.key });
  return row;
}

/** Technical notes: the assignee (or PM) records effort, feasibility, dependencies and notes. */
export async function saveTicketNotes(actor: Actor, ticketId: string, input: { effort: string; feasibility: string; dependencies: string; notes: string }) {
  const [ticket] = await getDb().select().from(tickets).where(eq(tickets.id, ticketId));
  if (!ticket) throw new Error("Ticket not found");
  const allowed = actor.role === "pm" || (actor.role === "engineer" && ticket.assigneeId === actor.id);
  if (!allowed) throw new Error("Only the assignee or the PM can edit technical notes");
  await getDb().update(tickets).set({
    effort: (["S", "M", "L", "XL"].includes(input.effort) ? input.effort : ticket.effort) as "M",
    feasibility: input.feasibility.trim() || null, dependencies: input.dependencies.trim() || null, notes: input.notes.trim() || null,
  }).where(eq(tickets.id, ticketId));
}

export async function listProjects(actor: Actor) {
  const db = getDb();
  const scope = visibleAccounts(actor);
  const rows = await db.select({ id: projects.id, name: projects.name, status: projects.status, accountId: accounts.id, accountName: accounts.name, accountTier: accounts.tier, accountSegment: accounts.segment })
    .from(projects).innerJoin(accounts, eq(accounts.id, projects.accountId)).where(scope).orderBy(asc(accounts.name), asc(projects.name));
  const ids = rows.map((r) => r.id);
  const members = ids.length ? await db.select({ projectId: projectMembers.projectId, name: users.name }).from(projectMembers).innerJoin(users, eq(users.id, projectMembers.userId)).where(inArray(projectMembers.projectId, ids)) : [];
  const ticketRows = ids.length ? await db.select({ projectId: tickets.projectId, status: tickets.status, needId: needs.id, needTitle: needs.title }).from(tickets).innerJoin(needs, eq(needs.id, tickets.needId)).where(inArray(tickets.projectId, ids)) : [];
  return rows.map((p) => {
    const t = ticketRows.filter((x) => x.projectId === p.id);
    const linked = new Map(t.map((x) => [x.needId, x.needTitle]));
    return { ...p, team: members.filter((m) => m.projectId === p.id).map((m) => m.name), openTickets: t.filter((x) => x.status !== "released").length, needs: [...linked].map(([id, title]) => ({ id, title })) };
  });
}

export async function getProject(actor: Actor, id: string) {
  const all = await listProjects(actor);
  const project = all.find((p) => p.id === id);
  if (!project) return null;
  const projectTickets = await listTickets(actor, { projectId: id });
  const needIds = project.needs.map((n) => n.id);
  const updates = needIds.length
    ? await getDb().select({ id: statusUpdates.id, subject: statusUpdates.subject, sentAt: statusUpdates.sentAt, needTitle: needs.title })
      .from(statusUpdates).innerJoin(needs, eq(needs.id, statusUpdates.needId))
      .where(and(inArray(statusUpdates.needId, needIds), isNotNull(statusUpdates.sentAt))).orderBy(desc(statusUpdates.sentAt)).limit(5)
    : [];
  return { ...project, tickets: projectTickets, updates };
}

/** Clients an actor can log feedback for, with their projects. */
export async function feedbackTargets(actor: Actor) {
  const db = getDb();
  const scope = visibleAccounts(actor);
  const accountRows = await db.select({ id: accounts.id, name: accounts.name }).from(accounts).where(scope).orderBy(asc(accounts.name));
  const ids = accountRows.map((a) => a.id);
  const projectRows = ids.length ? await db.select({ id: projects.id, name: projects.name, accountId: projects.accountId }).from(projects).where(inArray(projects.accountId, ids)).orderBy(asc(projects.name)) : [];
  return accountRows.map((a) => ({ ...a, projects: projectRows.filter((p) => p.accountId === a.id) }));
}

export async function engineers() {
  return getDb().select({ id: users.id, name: users.name }).from(users).where(eq(users.role, "engineer")).orderBy(asc(users.name));
}
