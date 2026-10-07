import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { accounts, staffing, users } from "@/db/schema";
import { ROLE_HOME } from "./labels";
import type { Actor, Role } from "./permissions";

// Demo sign-in: the session cookie holds a seeded user's id. Every page and server
// action resolves the actor here and checks the role on the server.
export const SESSION_COOKIE = "nh_user";

export interface SessionActor extends Actor {
  name: string;
  email: string;
  accountName: string | null;
}

export async function loadActor(userId: string): Promise<SessionActor | null> {
  const db = getDb();
  const [user] = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role, accountId: users.accountId, accountName: accounts.name })
    .from(users)
    .leftJoin(accounts, eq(accounts.id, users.accountId))
    .where(eq(users.id, userId));
  if (!user) return null;
  const staffed = user.role === "engineer"
    ? (await db.select({ accountId: staffing.accountId }).from(staffing).where(eq(staffing.engineerId, user.id))).map((s) => s.accountId)
    : [];
  return { ...user, role: user.role as Role, staffedAccountIds: staffed };
}

export async function getActor(): Promise<SessionActor | null> {
  const id = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) return null;
  return loadActor(id);
}

/** Resolves the signed-in actor or redirects; wrong role goes to the actor's own home. */
export async function requireActor(roles?: Role[]): Promise<SessionActor> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (roles && !roles.includes(actor.role)) redirect(ROLE_HOME[actor.role]);
  return actor;
}
