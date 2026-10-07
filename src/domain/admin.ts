import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { accounts, staffing, strategicGoals, users } from "@/db/schema";
import type { Actor, Role } from "./permissions";

// Workspace Admin: clients, staffing, users and strategic goals. Read-only on product decisions.

function assertAdmin(actor: Actor) {
  if (actor.role !== "admin") throw new Error("Only the Workspace Admin can do this");
}

export async function listAccounts() {
  return getDb().select().from(accounts).orderBy(asc(accounts.name));
}

export async function createAccount(actor: Actor, input: { name: string; type: "client" | "prospect"; tier: string; segment: string; contractValue: number | null }) {
  assertAdmin(actor);
  if (!input.name.trim()) throw new Error("Client name is required");
  await getDb().insert(accounts).values({ ...input, name: input.name.trim(), tier: input.tier.trim() || "Mid-market", segment: input.segment.trim() || "General" });
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
  if (staffed) await db.insert(staffing).values({ engineerId, accountId }).onConflictDoNothing();
  else await db.delete(staffing).where(and(eq(staffing.engineerId, engineerId), eq(staffing.accountId, accountId)));
}

export async function listUsers() {
  return getDb().select({ id: users.id, name: users.name, email: users.email, role: users.role, accountName: accounts.name })
    .from(users).leftJoin(accounts, eq(accounts.id, users.accountId)).orderBy(asc(users.name));
}

export async function createUser(actor: Actor, input: { name: string; email: string; role: Role; accountId: string | null }) {
  assertAdmin(actor);
  if (!input.name.trim() || !input.email.includes("@")) throw new Error("Name and a valid email are required");
  if (input.role === "client" && !input.accountId) throw new Error("Client users need a client account");
  await getDb().insert(users).values({ name: input.name.trim(), email: input.email.trim().toLowerCase(), role: input.role, accountId: input.role === "client" ? input.accountId : null });
}

export async function setUserRole(actor: Actor, userId: string, role: Role) {
  assertAdmin(actor);
  if (userId === actor.id) throw new Error("You can't change your own role");
  if (role === "client") throw new Error("Create client users with their account instead");
  await getDb().update(users).set({ role, accountId: null }).where(eq(users.id, userId));
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
