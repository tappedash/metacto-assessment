import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { accounts, staffing, users } from "@/db/schema";
import { ROLE_HOME } from "./labels";
import type { Actor, Role } from "./permissions";

import { getAuth } from "@/lib/auth";

// Better Auth proves who the user is (session cookie -> Postgres session). Everything the
// app allows is decided here and in the domain layer, from the user's role, client
// account and staffing: every page and server action resolves the actor through this file.

export interface SessionActor extends Actor {
  name: string;
  email: string;
  accountName: string | null;
}

export async function loadActor(userId: string): Promise<SessionActor | null> {
  const db = getDb();
  const [user] = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role, accountId: users.accountId, accountName: accounts.name, active: users.active })
    .from(users)
    .leftJoin(accounts, eq(accounts.id, users.accountId))
    .where(eq(users.id, userId));
  if (!user || !user.active) return null; // deactivated: treated as signed out everywhere
  const staffed = user.role === "engineer"
    ? (await db.select({ accountId: staffing.accountId }).from(staffing).where(eq(staffing.engineerId, user.id))).map((s) => s.accountId)
    : [];
  const { active: _active, ...rest } = user;
  return { ...rest, role: user.role as Role, staffedAccountIds: staffed };
}

export async function getActor(): Promise<SessionActor | null> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;
  return loadActor(session.user.id);
}

/** Resolves the signed-in actor or redirects; wrong role goes to the actor's own home. */
export async function requireActor(roles?: Role[]): Promise<SessionActor> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (roles && !roles.includes(actor.role)) redirect(ROLE_HOME[actor.role]);
  return actor;
}
