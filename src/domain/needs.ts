import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { accounts, needs, projects, requests, statusUpdates, supports, tickets, users } from "@/db/schema";
import { canViewAccountEvidence, type Actor } from "./permissions";

// Demand comes from Feature Requests, supporters and accounts. Strategic Value comes
// from who is affected (enterprise accounts, contract value). Ticket counts are never used.

export interface Signals {
  requests: number;
  supporters: number;
  accounts: number;
  enterpriseAccounts: number;
  contractValue: number;
  recent30: number;
  prior30: number;
  trendPct: number | null;
  demandLevel: number; // 1-4
  strategicLevel: number; // 1-4
}

export function demandLevel(s: Pick<Signals, "accounts" | "supporters">): number {
  const score = s.accounts + s.supporters / 3;
  return score < 2 ? 1 : score < 3.5 ? 2 : score < 5 ? 3 : 4;
}

export function strategicLevel(s: Pick<Signals, "enterpriseAccounts" | "contractValue">): number {
  const score = s.enterpriseAccounts * 1.5 + s.contractValue / 1_000_000;
  return score < 1.5 ? 1 : score < 2.5 ? 2 : score < 4 ? 3 : 4;
}

export async function needSignals(needIds?: string[]): Promise<Map<string, Signals>> {
  const db = getDb();
  const filter = needIds?.length ? sql`AND n.id IN (${sql.join(needIds.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``;
  const rows = await db.execute<{
    id: string; requests: number; accounts: number; enterprise_accounts: number; contract_value: number;
    recent30: number; prior30: number; supporters: number;
  }>(sql`
    SELECT n.id,
      count(DISTINCT r.id)::int AS requests,
      count(DISTINCT r.account_id)::int AS accounts,
      count(DISTINCT r.account_id) FILTER (WHERE a.tier = 'Enterprise')::int AS enterprise_accounts,
      count(DISTINCT r.id) FILTER (WHERE r.created_at > now() - interval '30 days')::int AS recent30,
      count(DISTINCT r.id) FILTER (WHERE r.created_at <= now() - interval '30 days' AND r.created_at > now() - interval '60 days')::int AS prior30,
      COALESCE((SELECT sum(acc.contract_value) FROM accounts acc WHERE acc.id IN
        (SELECT r2.account_id FROM requests r2 WHERE r2.need_id = n.id AND r2.link_state = 'confirmed')), 0)::bigint AS contract_value,
      (SELECT count(*) FROM supports s WHERE s.need_id = n.id)::int AS supporters
    FROM needs n
    LEFT JOIN requests r ON r.need_id = n.id AND r.link_state = 'confirmed'
    LEFT JOIN accounts a ON a.id = r.account_id
    WHERE true ${filter}
    GROUP BY n.id`);
  const map = new Map<string, Signals>();
  for (const r of rows) {
    const base = {
      requests: r.requests, supporters: r.supporters, accounts: r.accounts, enterpriseAccounts: r.enterprise_accounts,
      contractValue: Number(r.contract_value), recent30: r.recent30, prior30: r.prior30,
      trendPct: r.prior30 > 0 ? Math.round(((r.recent30 - r.prior30) / r.prior30) * 100) : null,
    };
    map.set(r.id, { ...base, demandLevel: demandLevel(base), strategicLevel: strategicLevel(base) });
  }
  return map;
}

export async function listNeeds() {
  const rows = await getDb().select().from(needs).orderBy(asc(needs.title));
  const signals = await needSignals();
  return rows.map((n) => ({ ...n, signals: signals.get(n.id)! }));
}

export async function getNeed(id: string) {
  const [need] = await getDb().select().from(needs).where(eq(needs.id, id));
  return need ?? null;
}

export interface EvidenceItem {
  id: string;
  label: string; // R1, R2... stable per Need (oldest first)
  title: string;
  why: string;
  accountId: string;
  accountName: string;
  submittedBy: string;
  submitterRole: string;
  onBehalf: boolean;
  linkType: string | null;
  createdAt: Date;
}

/** Confirmed Feature Requests for a Need, with visibility applied for the actor. */
export async function needEvidence(needId: string, actor: Actor) {
  const rows = await getDb()
    .select({
      id: requests.id, title: requests.title, why: requests.why, accountId: requests.accountId, accountName: accounts.name,
      submittedBy: users.name, submitterRole: users.role, onBehalf: requests.onBehalf, linkType: requests.linkType, createdAt: requests.createdAt,
    })
    .from(requests)
    .innerJoin(accounts, eq(accounts.id, requests.accountId))
    .innerJoin(users, eq(users.id, requests.submittedBy))
    .where(and(eq(requests.needId, needId), eq(requests.linkState, "confirmed")))
    .orderBy(asc(requests.createdAt), asc(requests.id));
  const all: EvidenceItem[] = rows.map((r, i) => ({ ...r, label: `R${i + 1}` }));
  const visible = all.filter((e) => canViewAccountEvidence(actor, e.accountId));
  const hidden = all.filter((e) => !canViewAccountEvidence(actor, e.accountId));
  return { all, visible, hiddenCount: hidden.length, hiddenAccounts: new Set(hidden.map((h) => h.accountId)).size };
}

/** Delivery tickets linked to a Need (the "why" link), with project and client. */
export async function needTickets(needId: string) {
  return getDb()
    .select({
      id: tickets.id, key: tickets.key, title: tickets.title, status: tickets.status, priority: tickets.priority,
      projectId: projects.id, projectName: projects.name, accountId: accounts.id, accountName: accounts.name, assignee: users.name,
    })
    .from(tickets)
    .innerJoin(projects, eq(projects.id, tickets.projectId))
    .innerJoin(accounts, eq(accounts.id, projects.accountId))
    .leftJoin(users, eq(users.id, tickets.assigneeId))
    .where(eq(tickets.needId, needId))
    .orderBy(asc(tickets.key));
}

/** Customer-visible progress: only updates the PM approved and sent. */
export async function sentUpdates(needId: string) {
  return getDb()
    .select()
    .from(statusUpdates)
    .where(and(eq(statusUpdates.needId, needId), isNotNull(statusUpdates.sentAt)))
    .orderBy(desc(statusUpdates.sentAt));
}

export async function isSupporting(userId: string, needId: string) {
  const [row] = await getDb().select().from(supports).where(and(eq(supports.userId, userId), eq(supports.needId, needId)));
  return Boolean(row);
}

export async function needsByIds(ids: string[]) {
  if (!ids.length) return [];
  return getDb().select().from(needs).where(inArray(needs.id, ids));
}
