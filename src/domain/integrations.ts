import { and, desc, eq, isNotNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { githubActivity, needs, projectIntegrations, projects, projectStatuses, tickets, users } from "@/db/schema";
import { demoGithubActivity, fetchGithubActivity, findTicketKeys } from "@/integrations/github";
import { jiraConnector } from "@/integrations/jira";
import { LocalTicketConnector, type GithubConfig, type GithubItem, type JiraConfig, type TicketConnector } from "@/integrations/types";
import { getEnv } from "@/lib/env";
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import { hrefs, notify, ticketPeople } from "./notifications";
import { canViewAccountEvidence, type Actor } from "./permissions";

// Optional project integrations. Jira: link a Needs Hub ticket to an issue and show its
// status/assignee as last synced. GitHub: trace commits, PRs and branches that mention a
// ticket key. Both are internal: customers never see Jira or GitHub data.

function assertConfigure(actor: Actor) {
  if (actor.role !== "admin" && actor.role !== "pm") throw new Error("Only the Admin or the PM can configure integrations");
}

export interface IntegrationView {
  kind: "jira" | "github";
  enabled: boolean;
  config: JiraConfig | GithubConfig;
  hasToken: boolean;
  lastSyncAt: Date | null;
  lastError: string | null;
}

export async function projectIntegrationsFor(projectId: string): Promise<{ jira: IntegrationView | null; github: IntegrationView | null }> {
  const rows = await getDb().select().from(projectIntegrations).where(eq(projectIntegrations.projectId, projectId));
  const view = (kind: "jira" | "github") => {
    const r = rows.find((x) => x.kind === kind);
    return r ? { kind, enabled: r.enabled, config: r.config as JiraConfig & GithubConfig, hasToken: Boolean(r.secret), lastSyncAt: r.lastSyncAt, lastError: r.lastError } : null;
  };
  return { jira: view("jira"), github: view("github") };
}

async function saveIntegration(projectId: string, kind: "jira" | "github", config: JiraConfig | GithubConfig, enabled: boolean, token: string) {
  const db = getDb();
  const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId));
  if (!project) throw new Error("Project not found");
  const secret = token.trim() ? { secret: encryptSecret(token.trim()) } : {}; // blank keeps the saved token
  await db.insert(projectIntegrations).values({ projectId, kind, config, enabled, ...secret })
    .onConflictDoUpdate({ target: [projectIntegrations.projectId, projectIntegrations.kind], set: { config, enabled, lastError: null, ...secret } });
}

export async function saveJira(actor: Actor, projectId: string, input: JiraConfig & { enabled: boolean; token: string }) {
  assertConfigure(actor);
  const siteUrl = input.siteUrl.trim().replace(/\/+$/, "");
  if (!/^https:\/\/[^\s/]+$/.test(siteUrl)) throw new Error("Jira site must look like https://your-team.atlassian.net");
  const projectKey = input.projectKey.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(projectKey)) throw new Error("Jira project key must look like PROJ");
  if (!input.demo && !input.email.includes("@")) throw new Error("Enter the Jira account email used with the API token");
  await saveIntegration(projectId, "jira", { siteUrl, projectKey, email: input.email.trim(), issueType: input.issueType.trim() || "Task", demo: input.demo }, input.enabled, input.token);
}

export async function saveGithub(actor: Actor, projectId: string, input: { repos: string; enabled: boolean; demo: boolean; token: string }) {
  assertConfigure(actor);
  const repos = [...new Set(input.repos.split(/[\s,]+/).map((r) => r.trim().replace(/^https:\/\/github\.com\//, "").replace(/\/+$/, "")).filter(Boolean))];
  if (!repos.length) throw new Error("Add at least one repository (owner/name)");
  const bad = repos.find((r) => !/^[\w.-]+\/[\w.-]+$/.test(r));
  if (bad) throw new Error(`"${bad}" isn't a repository name like owner/name`);
  await saveIntegration(projectId, "github", { repos, demo: input.demo }, input.enabled, input.token);
}

export async function disconnect(actor: Actor, projectId: string, kind: "jira" | "github") {
  assertConfigure(actor);
  await getDb().delete(projectIntegrations).where(and(eq(projectIntegrations.projectId, projectId), eq(projectIntegrations.kind, kind)));
}

async function integrationRow(projectId: string, kind: "jira" | "github") {
  const [row] = await getDb().select().from(projectIntegrations)
    .where(and(eq(projectIntegrations.projectId, projectId), eq(projectIntegrations.kind, kind), eq(projectIntegrations.enabled, true)));
  return row ?? null;
}

/** Jira when the project has it enabled; otherwise the local connector (Needs Hub only). */
export async function ticketConnector(projectId: string): Promise<TicketConnector> {
  const row = await integrationRow(projectId, "jira");
  if (!row) return LocalTicketConnector;
  const linked = await getDb().select({ id: tickets.id }).from(tickets).where(and(eq(tickets.projectId, projectId), isNotNull(tickets.externalKey)));
  return jiraConnector(row.config as JiraConfig, row.secret ? decryptSecret(row.secret) : null, fetch, linked.length);
}

async function ticketWithLocal(ticketId: string) {
  const [t] = await getDb().select({
    id: tickets.id, key: tickets.key, title: tickets.title, projectId: tickets.projectId, externalKey: tickets.externalKey,
    status: projectStatuses.name, stage: projectStatuses.stage, assignee: users.name, needTitle: needs.title,
  }).from(tickets).innerJoin(projectStatuses, eq(projectStatuses.id, tickets.statusId)).innerJoin(needs, eq(needs.id, tickets.needId))
    .leftJoin(users, eq(users.id, tickets.assigneeId)).where(eq(tickets.id, ticketId));
  if (!t) throw new Error("Ticket not found");
  return t;
}

/** PM creates (or links) the Jira issue for a ticket: NH T-107 -> CARR-184. */
export async function linkJiraIssue(actor: Actor, ticketId: string) {
  if (actor.role !== "pm") throw new Error("Only the Product Manager links tickets to Jira");
  const t = await ticketWithLocal(ticketId);
  if (t.externalKey) throw new Error(`Already linked to ${t.externalKey}`);
  const connector = await ticketConnector(t.projectId);
  if (connector.kind === "local") throw new Error("This project isn't connected to Jira");
  const issue = await connector.createIssue({
    key: t.key, title: t.title, needTitle: t.needTitle, link: `${getEnv().BETTER_AUTH_URL}/pm/tickets/${t.id}`,
    local: { status: t.status, stage: t.stage, assignee: t.assignee },
  });
  if (!issue) return;
  await getDb().update(tickets).set({ externalKey: issue.key, externalUrl: issue.url, externalStatus: issue.status, externalAssignee: issue.assignee, syncedAt: new Date() }).where(eq(tickets.id, ticketId));
  const people = await ticketPeople(ticketId);
  await notify({ event: "jira.linked", entity: { type: "ticket", id: ticketId }, actorId: actor.id, recipients: [people.assigneeId, ...people.pms],
    title: `${t.key} linked to Jira ${issue.key}`, body: `${t.key} ${t.title} is now tracked in Jira as ${issue.key}.`, href: hrefs.ticket(ticketId) });
}

/** Refresh Jira status/assignee for the project's linked tickets. A newly blocked issue is worth a notification. */
export async function syncJira(actor: Actor, projectId: string) {
  assertConfigure(actor);
  const db = getDb();
  const connector = await ticketConnector(projectId);
  if (connector.kind === "local") throw new Error("This project isn't connected to Jira");
  const linked = await db.select({ id: tickets.id }).from(tickets).where(and(eq(tickets.projectId, projectId), isNotNull(tickets.externalKey)));
  try {
    for (const { id } of linked) {
      const t = await ticketWithLocal(id);
      const [before] = await db.select({ status: tickets.externalStatus }).from(tickets).where(eq(tickets.id, id));
      const now = await connector.fetchIssue({ externalKey: t.externalKey!, local: { status: t.status, stage: t.stage, assignee: t.assignee } });
      if (!now) continue;
      await db.update(tickets).set({ externalStatus: now.status, externalAssignee: now.assignee, syncedAt: new Date() }).where(eq(tickets.id, id));
      if (now.blocked && !/block/i.test(before.status ?? "")) {
        const people = await ticketPeople(id);
        await notify({ event: "jira.blocked", entity: { type: "ticket", id }, actorId: actor.id, recipients: [people.assigneeId, ...people.pms],
          title: `${t.key} is blocked in Jira`, body: `${t.externalKey} (${t.title}) moved to "${now.status}" in Jira.`, href: hrefs.ticket(id) });
      }
    }
    await db.update(projectIntegrations).set({ lastSyncAt: new Date(), lastError: null }).where(and(eq(projectIntegrations.projectId, projectId), eq(projectIntegrations.kind, "jira")));
    return linked.length;
  } catch (error) {
    await db.update(projectIntegrations).set({ lastError: (error as Error).message }).where(and(eq(projectIntegrations.projectId, projectId), eq(projectIntegrations.kind, "jira")));
    throw error;
  }
}

/**
 * Store GitHub activity and link it to tickets whose key (local or Jira) appears in it.
 * Returns the pull requests that became linked to a ticket for the first time.
 */
export async function importGithubActivity(projectId: string, items: GithubItem[]) {
  const db = getDb();
  const projectTickets = await db.select({ id: tickets.id, key: tickets.key, externalKey: tickets.externalKey }).from(tickets).where(eq(tickets.projectId, projectId));
  const byKey = new Map<string, string>();
  for (const t of projectTickets) {
    byKey.set(t.key.toUpperCase(), t.id);
    if (t.externalKey) byKey.set(t.externalKey.toUpperCase(), t.id);
  }
  const newlyLinkedPrs: { ticketId: string; title: string; url: string }[] = [];
  for (const item of items) {
    const ticketId = findTicketKeys(item, [...byKey.keys()]).map((k) => byKey.get(k)!)[0] ?? null;
    const values = { projectId, ticketId, kind: item.kind, repo: item.repo, ref: item.ref, title: item.title.slice(0, 300), author: item.author, url: item.url, occurredAt: item.occurredAt };
    const [existing] = await db.select({ id: githubActivity.id, ticketId: githubActivity.ticketId }).from(githubActivity)
      .where(and(eq(githubActivity.projectId, projectId), eq(githubActivity.kind, item.kind), eq(githubActivity.repo, item.repo), eq(githubActivity.ref, item.ref)));
    if (existing) {
      // Branches have no date of their own: keep the first time we saw them.
      await db.update(githubActivity).set({ ticketId, title: values.title, author: values.author, url: values.url, ...(item.kind === "branch" ? {} : { occurredAt: values.occurredAt }) }).where(eq(githubActivity.id, existing.id));
    } else {
      await db.insert(githubActivity).values(values);
    }
    if (item.kind === "pull_request" && ticketId && existing?.ticketId !== ticketId) newlyLinkedPrs.push({ ticketId, title: item.title, url: item.url });
  }
  return newlyLinkedPrs;
}

export async function syncGithub(actor: Actor, projectId: string) {
  assertConfigure(actor);
  const row = await integrationRow(projectId, "github");
  if (!row) throw new Error("This project isn't connected to GitHub");
  const config = row.config as GithubConfig;
  const db = getDb();
  try {
    const token = row.secret ? decryptSecret(row.secret) : null;
    const items = (await Promise.all(config.repos.map((r) => (config.demo ? demoGithubActivity(r) : fetchGithubActivity(r, token))))).flat();
    const prs = await importGithubActivity(projectId, items);
    for (const pr of prs) {
      const people = await ticketPeople(pr.ticketId);
      await notify({ event: "github.pr_linked", entity: { type: "ticket", id: pr.ticketId }, actorId: actor.id, recipients: [people.assigneeId, ...people.pms],
        title: `${people.key}: pull request linked`, body: `${pr.title}\n${pr.url}`, href: hrefs.ticket(pr.ticketId) });
    }
    await db.update(projectIntegrations).set({ lastSyncAt: new Date(), lastError: null }).where(eq(projectIntegrations.id, row.id));
    return items.length;
  } catch (error) {
    await db.update(projectIntegrations).set({ lastError: (error as Error).message }).where(eq(projectIntegrations.id, row.id));
    throw error;
  }
}

// ---------- read side (team only; never used on client pages) ----------

async function assertTeamAccess(actor: Actor, projectId: string) {
  const [p] = await getDb().select({ accountId: projects.accountId }).from(projects).where(eq(projects.id, projectId));
  const allowed = p && (actor.role === "pm" || actor.role === "admin" || (actor.role === "engineer" && canViewAccountEvidence(actor, p.accountId)));
  if (!allowed) throw new Error("Project not found");
}

export async function ticketActivity(actor: Actor, ticketId: string) {
  const [t] = await getDb().select({ projectId: tickets.projectId }).from(tickets).where(eq(tickets.id, ticketId));
  if (!t) return [];
  await assertTeamAccess(actor, t.projectId);
  return getDb().select().from(githubActivity).where(eq(githubActivity.ticketId, ticketId)).orderBy(desc(githubActivity.occurredAt));
}

export async function projectActivity(actor: Actor, projectId: string, limit = 20) {
  await assertTeamAccess(actor, projectId);
  return getDb().select({ id: githubActivity.id, kind: githubActivity.kind, repo: githubActivity.repo, ref: githubActivity.ref, title: githubActivity.title, author: githubActivity.author,
    url: githubActivity.url, occurredAt: githubActivity.occurredAt, ticketKey: tickets.key, ticketId: tickets.id })
    .from(githubActivity).leftJoin(tickets, eq(tickets.id, githubActivity.ticketId))
    .where(eq(githubActivity.projectId, projectId)).orderBy(desc(githubActivity.occurredAt)).limit(limit);
}

