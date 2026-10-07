import { and, asc, desc, eq, ilike, inArray, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db/client";
import { accounts, needs, projectMembers, projects, projectStatuses, statusUpdates, tickets, users } from "@/db/schema";
import { draftStatusUpdate } from "./decisions";
import { allowedTicketMoves, canViewAccountEvidence, type Actor } from "./permissions";
import { hrefs, notify, ticketPeople } from "./notifications";
import { getSettings } from "./settings";
import { PUBLIC_STATUS, publicStatusOf, recordStatusChange } from "./tracking";
import { projectWorkflow, type StatusDef } from "./workflow";

// Delivery layer: Client (account) -> Project -> Ticket. Each ticket links to the
// Customer Need that explains why it is being built.

const ticketColumns = {
  id: tickets.id, key: tickets.key, title: tickets.title, priority: tickets.priority, effort: tickets.effort,
  statusId: projectStatuses.id, statusName: projectStatuses.name, stage: projectStatuses.stage, statusPosition: projectStatuses.position,
  assigneeId: tickets.assigneeId, assignee: users.name, projectId: projects.id, projectName: projects.name,
  accountId: accounts.id, accountName: accounts.name, needId: needs.id, needTitle: needs.title,
  feasibility: tickets.feasibility, dependencies: tickets.dependencies, notes: tickets.notes,
  externalKey: tickets.externalKey, externalUrl: tickets.externalUrl, externalStatus: tickets.externalStatus,
  externalAssignee: tickets.externalAssignee, syncedAt: tickets.syncedAt,
};

function ticketQuery() {
  return getDb()
    .select(ticketColumns)
    .from(tickets)
    .innerJoin(projects, eq(projects.id, tickets.projectId))
    .innerJoin(projectStatuses, eq(projectStatuses.id, tickets.statusId))
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
 * Moves a ticket to one of its project's statuses if the actor may. The Customer Need
 * follows delivery by stage: first ticket In progress -> Need "In Development"; all
 * tickets Done -> Need "Released". Each Need change drafts an update for the PM.
 */
export async function moveTicket(actor: Actor, ticketId: string, toStatusId: string, options: { note?: string } = {}) {
  const db = getDb();
  const [ticket] = await ticketQuery().where(eq(tickets.id, ticketId));
  if (!ticket || (actor.role === "engineer" && !canViewAccountEvidence(actor, ticket.accountId))) throw new Error("Ticket not found");
  const workflow = await projectWorkflow(ticket.projectId);
  const target = allowedTicketMoves(actor, { assigneeId: ticket.assigneeId, statusId: ticket.statusId, stage: ticket.stage }, workflow)
    .find((s) => s.id === toStatusId);
  if (!target) throw new Error("You can't move this ticket to that status");
  await db.update(tickets).set({ statusId: target.id }).where(eq(tickets.id, ticketId));
  const from = workflow.find((s) => s.id === ticket.statusId)!;
  await recordStatusChange(db, { ticketId, actorId: actor.id, from, to: target, note: options.note });
  await notifyStatusChange(actor, ticketId, from, target);

  const [need] = await db.select().from(needs).where(eq(needs.id, ticket.needId));
  const siblings = await db.select({ stage: projectStatuses.stage }).from(tickets)
    .innerJoin(projectStatuses, eq(projectStatuses.id, tickets.statusId)).where(eq(tickets.needId, ticket.needId));
  let next: "in_development" | "released" | null = null;
  if (target.stage === "in_progress" && need.status === "planned") next = "in_development";
  if (target.stage === "done" && siblings.every((s) => s.stage === "done") && need.status !== "released") next = "released";
  if (next) {
    await db.update(needs).set({ status: next }).where(eq(needs.id, need.id));
    await draftStatusUpdate(need.id, next, next === "released" ? "All delivery work for this is now released." : "Engineering has started building this.");
  }
  return { needStatusChanged: next, status: target.name };
}

/** PM / Need owner and the assignee hear about every move; customers only about public changes they opted into. */
async function notifyStatusChange(actor: Actor, ticketId: string, from: StatusDef, to: StatusDef) {
  const people = await ticketPeople(ticketId);
  const released = to.stage === "done" && from.stage !== "done";
  await notify({
    event: released ? "ticket.released" : "ticket.status", entity: { type: "ticket", id: ticketId }, actorId: actor.id,
    recipients: [...people.pms, people.assigneeId],
    title: released ? `${people.key} released: ${people.title}` : `${people.key} moved to ${to.name}`,
    body: `${people.key} ${people.title} moved from ${from.name} to ${to.name}.`, href: hrefs.ticket(ticketId),
  });
  const before = publicStatusOf(from), after = publicStatusOf(to);
  if (after && after !== before && (await getSettings()).customerNotify[after]) {
    await notify({
      event: "ticket.status", entity: { type: "ticket", id: ticketId }, actorId: actor.id, recipients: people.customers,
      title: `${people.title} moved to ${PUBLIC_STATUS[after].label}`, body: `${people.title} is now ${PUBLIC_STATUS[after].label}.`, href: hrefs.ticket(ticketId),
    });
  }
}

/** PM changes who works on a ticket or how urgent it is; the people involved are told. */
export async function updateTicket(actor: Actor, ticketId: string, input: { assigneeId: string | null; priority: string | null }) {
  if (actor.role !== "pm") throw new Error("Only the Product Manager assigns and prioritises tickets");
  const db = getDb();
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
  if (!ticket) throw new Error("Ticket not found");
  const priority = (["P0", "P1", "P2", "P3"].includes(input.priority ?? "") ? input.priority : null) as "P1" | null;
  if (input.assigneeId) {
    const [engineer] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, input.assigneeId), eq(users.role, "engineer"), eq(users.active, true)));
    if (!engineer) throw new Error("Assign an active engineer");
  }
  await db.update(tickets).set({ assigneeId: input.assigneeId, priority }).where(eq(tickets.id, ticketId));
  const people = await ticketPeople(ticketId);
  if (input.assigneeId && input.assigneeId !== ticket.assigneeId) {
    await notify({ event: "ticket.assigned", entity: { type: "ticket", id: ticketId }, actorId: actor.id, recipients: [input.assigneeId],
      title: `${ticket.key} assigned to you: ${ticket.title}`, body: `You're now the assignee of ${ticket.key} ${ticket.title}.`, href: hrefs.ticket(ticketId) });
  }
  if (priority !== ticket.priority) {
    await notify({ event: "ticket.priority", entity: { type: "ticket", id: ticketId }, actorId: actor.id, recipients: [...people.pms, people.assigneeId],
      title: `${ticket.key} priority: ${priority ?? "none"}`, body: `${ticket.key} ${ticket.title} priority changed from ${ticket.priority ?? "none"} to ${priority ?? "none"}.`, href: hrefs.ticket(ticketId) });
  }
}

export async function nextTicketKey(): Promise<string> {
  const [row] = await getDb().select({ max: sql<number>`COALESCE(max(substring(key from 3)::int), 100)` }).from(tickets);
  return `T-${Number(row.max) + 1}`;
}

export async function createTicket(actor: Actor, input: { needId: string; projectId: string; title: string; priority: string | null; effort: string | null; assigneeId: string | null }) {
  if (actor.role !== "pm") throw new Error("Only the Product Manager creates tickets");
  if (!input.title.trim()) throw new Error("Give the ticket a title");
  const key = await nextTicketKey();
  // New tickets start in the project's first Backlog status.
  const start = (await projectWorkflow(input.projectId)).find((s) => s.stage === "backlog");
  if (!start) throw new Error("This project has no Backlog status");
  const [row] = await getDb().insert(tickets).values({
    key, title: input.title.trim(), needId: input.needId, projectId: input.projectId, statusId: start.id,
    priority: (input.priority || null) as "P1" | null, effort: (input.effort || null) as "M" | null, assigneeId: input.assigneeId || null,
  }).returning({ id: tickets.id, key: tickets.key });
  if (input.assigneeId) {
    await notify({ event: "ticket.created", entity: { type: "ticket", id: row.id }, actorId: actor.id, recipients: [input.assigneeId],
      title: `New ticket for you: ${row.key} ${input.title.trim()}`, body: `${row.key} ${input.title.trim()} was created and assigned to you.`, href: hrefs.ticket(row.id) });
  }
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
  const ticketRows = ids.length ? await db.select({ projectId: tickets.projectId, stage: projectStatuses.stage, needId: needs.id, needTitle: needs.title }).from(tickets)
    .innerJoin(projectStatuses, eq(projectStatuses.id, tickets.statusId)).innerJoin(needs, eq(needs.id, tickets.needId)).where(inArray(tickets.projectId, ids)) : [];
  return rows.map((p) => {
    const t = ticketRows.filter((x) => x.projectId === p.id);
    const linked = new Map(t.map((x) => [x.needId, x.needTitle]));
    return { ...p, team: members.filter((m) => m.projectId === p.id).map((m) => m.name), openTickets: t.filter((x) => x.stage !== "done").length, needs: [...linked].map(([id, title]) => ({ id, title })) };
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
  return getDb().select({ id: users.id, name: users.name }).from(users).where(and(eq(users.role, "engineer"), eq(users.active, true))).orderBy(asc(users.name));
}
