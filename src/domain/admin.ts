import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { accounts, authSessions, projectMembers, projects, staffing, strategicGoals, tickets, users } from "@/db/schema";
import { hrefs, notify } from "./notifications";
import type { Actor, Role } from "./permissions";
import { createDefaultWorkflow } from "./workflow";

// Workspace Admin: users, client accounts, projects, staffing and strategic goals. Fixed roles
// only (no custom roles or permission builders). Read-only on product decisions.

function assertAdmin(actor: Actor) {
  if (actor.role !== "admin") throw new Error("Only the Workspace Admin can do this");
}

export async function listAccounts() {
  return getDb().select().from(accounts).orderBy(asc(accounts.name));
}

export interface AccountInput { name: string; type: "client" | "prospect"; tier: string; segment: string; contractValue: number | null; ownerPmId: string | null }

async function checkPm(ownerPmId: string | null) {
  if (!ownerPmId) return;
  const [pm] = await getDb().select({ id: users.id }).from(users).where(and(eq(users.id, ownerPmId), eq(users.role, "pm")));
  if (!pm) throw new Error("The responsible PM must be a Product Manager");
}

export async function createAccount(actor: Actor, input: AccountInput) {
  assertAdmin(actor);
  if (!input.name.trim()) throw new Error("Client name is required");
  await checkPm(input.ownerPmId);
  await getDb().insert(accounts).values({ ...input, name: input.name.trim(), tier: input.tier.trim() || "Mid-market", segment: input.segment.trim() || "General" });
}

export async function updateAccount(actor: Actor, id: string, input: AccountInput) {
  assertAdmin(actor);
  if (!input.name.trim()) throw new Error("Client name is required");
  await checkPm(input.ownerPmId);
  await getDb().update(accounts).set({ ...input, name: input.name.trim(), tier: input.tier.trim() || "Mid-market", segment: input.segment.trim() || "General" }).where(eq(accounts.id, id));
}

/** Per account: its projects and people (users and staffed engineers). */
export async function accountOverview() {
  const db = getDb();
  const [rows, projectRows, userRows, staffRows] = await Promise.all([
    listAccounts(),
    db.select({ id: projects.id, name: projects.name, status: projects.status, accountId: projects.accountId }).from(projects).orderBy(asc(projects.name)),
    db.select({ id: users.id, name: users.name, email: users.email, active: users.active, accountId: users.accountId }).from(users).where(eq(users.role, "client")).orderBy(asc(users.name)),
    db.select({ accountId: staffing.accountId, name: users.name }).from(staffing).innerJoin(users, eq(users.id, staffing.engineerId)).orderBy(asc(users.name)),
  ]);
  return rows.map((a) => ({
    ...a,
    projects: projectRows.filter((p) => p.accountId === a.id),
    users: userRows.filter((u) => u.accountId === a.id),
    engineers: staffRows.filter((s) => s.accountId === a.id).map((s) => s.name),
  }));
}

// ---------- projects / engagements ----------

export async function listProjectsAdmin() {
  const db = getDb();
  const [rows, members] = await Promise.all([
    db.select({ id: projects.id, name: projects.name, status: projects.status, accountId: accounts.id, accountName: accounts.name,
      tickets: sql<number>`(SELECT count(*)::int FROM tickets t WHERE t.project_id = ${projects.id})` })
      .from(projects).innerJoin(accounts, eq(accounts.id, projects.accountId)).orderBy(asc(accounts.name), asc(projects.name)),
    db.select({ projectId: projectMembers.projectId, userId: users.id, name: users.name, role: users.role }).from(projectMembers).innerJoin(users, eq(users.id, projectMembers.userId)),
  ]);
  return rows.map((p) => ({ ...p, engineers: members.filter((m) => m.projectId === p.id && m.role === "engineer") }));
}

export interface ProjectInput { name: string; accountId: string; status: "planning" | "active" | "done" }

export async function createProject(actor: Actor, input: ProjectInput) {
  assertAdmin(actor);
  if (!input.name.trim()) throw new Error("Project name is required");
  const db = getDb();
  const [account] = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, input.accountId));
  if (!account) throw new Error("Choose the client account");
  await db.transaction(async (tx) => {
    const [row] = await tx.insert(projects).values({ ...input, name: input.name.trim() }).returning({ id: projects.id });
    await createDefaultWorkflow(tx, row.id);
  });
}

export async function updateProject(actor: Actor, id: string, input: ProjectInput) {
  assertAdmin(actor);
  if (!input.name.trim()) throw new Error("Project name is required");
  const db = getDb();
  const [project] = await db.select().from(projects).where(eq(projects.id, id));
  if (!project) throw new Error("Project not found");
  if (project.accountId !== input.accountId) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(tickets).where(eq(tickets.projectId, id));
    if (n > 0) throw new Error("This project already has tickets; it can't move to another client");
  }
  await db.update(projects).set({ ...input, name: input.name.trim() }).where(eq(projects.id, id));
}

/**
 * Staffing is Engineer -> Account -> Project: assigning an engineer to a project also staffs
 * them on its client account, which is what server-side visibility uses. Removing them from a
 * project keeps the account staffing (they may work on other projects for that client);
 * remove that on the Staffing page.
 */
export async function setProjectEngineer(actor: Actor, projectId: string, engineerId: string, assigned: boolean) {
  assertAdmin(actor);
  const db = getDb();
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  const [engineer] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, engineerId), eq(users.role, "engineer")));
  if (!project || !engineer) throw new Error("Project or engineer not found");
  if (!assigned) {
    await db.delete(projectMembers).where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, engineerId)));
    return;
  }
  const [added] = await db.insert(projectMembers).values({ projectId, userId: engineerId }).onConflictDoNothing().returning();
  await db.insert(staffing).values({ engineerId, accountId: project.accountId }).onConflictDoNothing();
  if (added) {
    await notify({ event: "project.staffed", entity: { type: "project", id: projectId }, actorId: actor.id, recipients: [engineerId],
      title: `You're staffed on ${project.name}`, body: `You've been added to the ${project.name} project. You can now see its client's requests and tickets.`, href: hrefs.project(projectId) });
  }
}

export async function staffingMatrix() {
  const db = getDb();
  const [engineerRows, accountRows, links] = await Promise.all([
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.role, "engineer")).orderBy(asc(users.name)),
    db.select({ id: accounts.id, name: accounts.name }).from(accounts).orderBy(asc(accounts.name)),
    db.select().from(staffing),
  ]);
  const set = new Set(links.map((l) => `${l.engineerId}:${l.accountId}`));
  return { engineers: engineerRows, accounts: accountRows, isStaffed: (e: string, a: string) => set.has(`${e}:${a}`) };
}

export async function setStaffing(actor: Actor, engineerId: string, accountId: string, staffed: boolean) {
  assertAdmin(actor);
  const db = getDb();
  if (staffed) {
    await db.insert(staffing).values({ engineerId, accountId }).onConflictDoNothing();
    return;
  }
  // Losing the account also removes them from its projects, so visibility stays consistent.
  await db.delete(staffing).where(and(eq(staffing.engineerId, engineerId), eq(staffing.accountId, accountId)));
  const accountProjects = (await db.select({ id: projects.id }).from(projects).where(eq(projects.accountId, accountId))).map((p) => p.id);
  if (accountProjects.length) await db.delete(projectMembers).where(and(eq(projectMembers.userId, engineerId), inArray(projectMembers.projectId, accountProjects)));
}

export async function listUsers() {
  return getDb().select({ id: users.id, name: users.name, email: users.email, role: users.role, active: users.active, accountId: users.accountId, accountName: accounts.name })
    .from(users).leftJoin(accounts, eq(accounts.id, users.accountId)).orderBy(asc(users.name));
}

/** One of the four fixed roles. Client users belong to exactly one client account. */
export async function setUserRole(actor: Actor, userId: string, role: Role, accountId: string | null = null) {
  assertAdmin(actor);
  if (userId === actor.id) throw new Error("You can't change your own role");
  const db = getDb();
  if (role === "client") {
    if (!accountId) throw new Error("Client users need a client account");
    const [account] = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, accountId));
    if (!account) throw new Error("Client account not found");
  }
  const [before] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId));
  if (!before) throw new Error("User not found");
  await db.update(users).set({ role, accountId: role === "client" ? accountId : null }).where(eq(users.id, userId));
  // An engineer who changes role keeps no client visibility.
  if (before.role === "engineer" && role !== "engineer") {
    await db.delete(staffing).where(eq(staffing.engineerId, userId));
    await db.delete(projectMembers).where(eq(projectMembers.userId, userId));
  }
}

/** Deactivated users can't sign in, are signed out now, and receive no notifications. */
export async function setUserActive(actor: Actor, userId: string, active: boolean) {
  assertAdmin(actor);
  if (userId === actor.id) throw new Error("You can't deactivate yourself");
  const db = getDb();
  await db.update(users).set({ active }).where(eq(users.id, userId));
  if (!active) await db.delete(authSessions).where(eq(authSessions.userId, userId));
}

export async function listGoals() {
  return getDb().select().from(strategicGoals).orderBy(asc(strategicGoals.code));
}

export async function saveGoal(actor: Actor, input: { id?: string; text: string }) {
  assertAdmin(actor);
  const text = input.text.trim();
  if (!text) throw new Error("Goal text is required");
  const db = getDb();
  if (input.id) {
    await db.update(strategicGoals).set({ text }).where(eq(strategicGoals.id, input.id));
    return;
  }
  const goals = await listGoals();
  if (goals.length >= 5) throw new Error("Keep it to 5 strategic goals");
  const next = Math.max(0, ...goals.map((g) => Number(g.code.slice(1)) || 0)) + 1;
  await db.insert(strategicGoals).values({ code: `G${next}`, text });
}

export async function deleteGoal(actor: Actor, id: string) {
  assertAdmin(actor);
  await getDb().delete(strategicGoals).where(eq(strategicGoals.id, id));
}
