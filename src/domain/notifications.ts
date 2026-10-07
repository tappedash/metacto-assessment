import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { accounts, needs, notifications, projects, requests, staffing, supports, tickets, users } from "@/db/schema";
import { getEnv } from "@/lib/env";
import { sendEmail } from "@/lib/mailer";
import type { Role } from "./permissions";

// Event notifications: when something important happens, the people related to that entity
// hear about it in-app and by email (Mailpit locally). Recipients come from relationships
// (request -> account -> PM, need -> owner + supporters, ticket -> assignee + PM + customers),
// never from hardcoded addresses. Every delivery attempt is stored as an audit row.

export type NotificationEvent =
  | "request.new" | "need.assigned" | "need.update_published"
  | "ticket.created" | "ticket.assigned" | "ticket.status" | "ticket.priority" | "ticket.released"
  | "ticket.update_pending" | "ticket.update_published" | "ticket.pm_input"
  | "rework.submitted" | "rework.resolved" | "project.staffed"
  | "jira.linked" | "jira.blocked" | "github.pr_linked";

// Assignment and rework always reach the in-app inbox, whatever the user's preference.
const CRITICAL = new Set<NotificationEvent>(["ticket.created", "ticket.assigned", "need.assigned", "project.staffed", "rework.submitted", "rework.resolved"]);

export interface NotifyInput {
  event: NotificationEvent;
  entity: { type: "request" | "need" | "ticket" | "project" | "rework"; id: string };
  actorId?: string | null; // never notified about their own action
  recipients: (string | null | undefined)[];
  title: string;
  body: string;
  href: (role: Role) => string;
}

export interface NotifyResult {
  notified: number;
  emailFailed: { email: string; error: string }[];
}

/** Delivers one event to its recipients on each channel they allow, and records every attempt. */
export async function notify(input: NotifyInput): Promise<NotifyResult> {
  const ids = [...new Set(input.recipients.filter((id): id is string => Boolean(id) && id !== input.actorId))];
  const result: NotifyResult = { notified: 0, emailFailed: [] };
  if (!ids.length) return result;
  const db = getDb();
  const people = await db.select({ id: users.id, name: users.name, email: users.email, role: users.role, active: users.active, notifyEmail: users.notifyEmail, notifyInApp: users.notifyInApp })
    .from(users).where(inArray(users.id, ids));
  const critical = CRITICAL.has(input.event);
  const base = { eventType: input.event, entityType: input.entity.type, entityId: input.entity.id, title: input.title, body: input.body };

  for (const person of people.filter((p) => p.active)) {
    const href = input.href(person.role);
    const inApp = person.notifyInApp || critical;
    await db.insert(notifications).values({ ...base, userId: person.id, href, channel: "in_app", status: inApp ? "sent" : "skipped", sentAt: inApp ? new Date() : null });

    if (!person.notifyEmail) {
      await db.insert(notifications).values({ ...base, userId: person.id, href, channel: "email", status: "skipped" });
    } else {
      try {
        await sendEmail({ to: `${person.name} <${person.email}>`, subject: input.title, text: `${input.body}\n\nOpen in Needs Hub: ${getEnv().BETTER_AUTH_URL}${href}` });
        await db.insert(notifications).values({ ...base, userId: person.id, href, channel: "email", status: "sent", sentAt: new Date() });
      } catch (error) {
        const message = (error as Error).message;
        result.emailFailed.push({ email: person.email, error: message });
        await db.insert(notifications).values({ ...base, userId: person.id, href, channel: "email", status: "failed", error: message });
      }
    }
    if (inApp || person.notifyEmail) result.notified++;
  }
  return result;
}

// ---------- recipient resolution ----------

async function activePms(): Promise<string[]> {
  return (await getDb().select({ id: users.id }).from(users).where(and(eq(users.role, "pm"), eq(users.active, true)))).map((r) => r.id);
}

/** Request -> account -> responsible PM (or every PM when the account has none). */
export async function accountPms(accountId: string): Promise<string[]> {
  const [account] = await getDb().select({ ownerPmId: accounts.ownerPmId }).from(accounts).where(eq(accounts.id, accountId));
  return account?.ownerPmId ? [account.ownerPmId] : activePms();
}

/** Need -> owner PM (or every PM). */
export async function needOwners(needId: string): Promise<string[]> {
  const [need] = await getDb().select({ ownerId: needs.ownerId }).from(needs).where(eq(needs.id, needId));
  return need?.ownerId ? [need.ownerId] : activePms();
}

/** Need -> customers following it: supporters and client requesters. */
export async function needCustomers(needId: string, accountId?: string): Promise<string[]> {
  const db = getDb();
  const [supporters, requesters] = await Promise.all([
    db.select({ id: users.id, accountId: users.accountId }).from(supports).innerJoin(users, eq(users.id, supports.userId)).where(eq(supports.needId, needId)),
    db.select({ id: users.id, accountId: users.accountId }).from(requests).innerJoin(users, eq(users.id, requests.submittedBy))
      .where(and(eq(requests.needId, needId), eq(requests.linkState, "confirmed"), eq(users.role, "client"))),
  ]);
  return [...new Set([...supporters, ...requesters].filter((u) => !accountId || u.accountId === accountId).map((u) => u.id))];
}

/** Need -> engineers staffed on the clients who asked for it. */
export async function needEngineers(needId: string): Promise<string[]> {
  const db = getDb();
  const accountIds = (await db.selectDistinct({ id: requests.accountId }).from(requests)
    .where(and(eq(requests.needId, needId), eq(requests.linkState, "confirmed")))).map((r) => r.id);
  if (!accountIds.length) return [];
  return (await db.selectDistinct({ id: staffing.engineerId }).from(staffing).where(inArray(staffing.accountId, accountIds))).map((r) => r.id);
}

/** Ticket -> assignee, owning PM(s), and the customers of that project's client who follow the Need. */
export async function ticketPeople(ticketId: string) {
  const [t] = await getDb().select({ key: tickets.key, title: tickets.title, assigneeId: tickets.assigneeId, needId: tickets.needId, accountId: projects.accountId })
    .from(tickets).innerJoin(projects, eq(projects.id, tickets.projectId)).where(eq(tickets.id, ticketId));
  if (!t) throw new Error("Ticket not found");
  const [pms, customers] = await Promise.all([needOwners(t.needId), needCustomers(t.needId, t.accountId)]);
  return { ...t, pms, customers };
}

// Where each role opens an entity.
export const hrefs = {
  ticket: (id: string) => (role: Role) => role === "client" ? `/client/tickets/${id}` : role === "engineer" ? `/engineer/tickets/${id}` : `/pm/tickets/${id}`,
  need: (id: string) => (role: Role) => role === "client" ? `/client/needs/${id}` : role === "engineer" ? `/engineer/needs/${id}` : role === "admin" ? "/admin/needs" : `/pm/needs/${id}`,
  project: (id: string) => (role: Role) => role === "engineer" ? `/engineer/projects/${id}` : role === "admin" ? "/admin/projects" : `/pm/projects/${id}`,
};

// ---------- inbox ----------

export async function inbox(userId: string, limit = 50) {
  return getDb().select().from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.channel, "in_app"), eq(notifications.status, "sent")))
    .orderBy(desc(notifications.createdAt)).limit(limit);
}

export async function unreadCount(userId: string): Promise<number> {
  const [row] = await getDb().select({ n: sql<number>`count(*)::int` }).from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.channel, "in_app"), eq(notifications.status, "sent"), isNull(notifications.readAt)));
  return row.n;
}

export async function markRead(userId: string, id?: string) {
  await getDb().update(notifications).set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt), id ? eq(notifications.id, id) : undefined));
}

export async function setPreferences(userId: string, prefs: { notifyEmail: boolean; notifyInApp: boolean }) {
  await getDb().update(users).set(prefs).where(eq(users.id, userId));
}
