import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { accounts, invitations, users } from "@/db/schema";
import { getEnv } from "@/lib/env";
import { sendEmail } from "@/lib/mailer";
import { ROLE_LABEL } from "./labels";
import { getSettings } from "./settings";
import type { Actor, Role } from "./permissions";

// Invitation-based onboarding. Only the Workspace Admin invites; the first sign-in with an
// invited email creates the user with the invited role (and client account). Nobody else
// can sign up, whatever sign-in method they use.

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export async function pendingInvitation(email: string) {
  const [row] = await getDb().select().from(invitations)
    .where(and(eq(invitations.email, normalizeEmail(email)), isNull(invitations.acceptedAt)));
  return row ?? null;
}

/** Whether this email may sign in at all: an existing user or a pending invitation. */
export async function canSignIn(email: string): Promise<boolean> {
  const [user] = await getDb().select({ id: users.id, active: users.active }).from(users).where(eq(users.email, normalizeEmail(email)));
  if (user) return user.active; // deactivated users can't sign in
  return Boolean(await pendingInvitation(email));
}

export class NotInvitedError extends Error {
  constructor() {
    super("This email hasn't been invited to Needs Hub. Ask your workspace admin for an invitation.");
  }
}

/**
 * Called by Better Auth before it creates a user (first sign-in, any method). Returns the
 * user data with role and client account taken from the invitation; throws if not invited.
 */
export async function applyInvitation<T extends { email: string; name?: string | null }>(user: T) {
  const invitation = await pendingInvitation(user.email);
  if (!invitation) throw new NotInvitedError();
  return {
    ...user,
    email: normalizeEmail(user.email),
    name: (user.name && user.name.trim()) || invitation.name || normalizeEmail(user.email).split("@")[0],
    role: invitation.role,
    accountId: invitation.role === "client" ? invitation.accountId : null,
  };
}

/** After the first sign-in: close the invitation and apply the Admin's default notification preferences. */
export async function markInvitationAccepted(email: string) {
  const db = getDb();
  await db.update(invitations).set({ acceptedAt: new Date() })
    .where(and(eq(invitations.email, normalizeEmail(email)), isNull(invitations.acceptedAt)));
  const settings = await getSettings();
  await db.update(users).set({ notifyEmail: settings.defaultNotifyEmail, notifyInApp: settings.defaultNotifyInApp }).where(eq(users.email, normalizeEmail(email)));
}

// ---------- Admin ----------

function assertAdmin(actor: Actor) {
  if (actor.role !== "admin") throw new Error("Only the Workspace Admin can invite people");
}

export async function inviteUser(actor: Actor, input: { name: string; email: string; role: Role; accountId: string | null }) {
  assertAdmin(actor);
  const email = normalizeEmail(input.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Enter a valid email address");
  if (input.role === "client" && !input.accountId) throw new Error("Client users need a client account");
  const db = getDb();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existing) throw new Error(`${email} already has access`);
  let accountName: string | null = null;
  if (input.role === "client") {
    const [account] = await db.select({ name: accounts.name }).from(accounts).where(eq(accounts.id, input.accountId!));
    if (!account) throw new Error("Client account not found");
    accountName = account.name;
  }
  const values = { email, name: input.name.trim() || null, role: input.role, accountId: input.role === "client" ? input.accountId : null, invitedBy: actor.id, acceptedAt: null };
  // Re-inviting a pending email updates the invitation.
  await db.insert(invitations).values(values).onConflictDoUpdate({ target: invitations.email, set: values });

  await sendInvitationEmail({ email, name: input.name.trim(), role: input.role, accountName });
}

async function sendInvitationEmail({ email, name, role, accountName }: { email: string; name: string; role: Role; accountName: string | null }) {
  const url = `${getEnv().BETTER_AUTH_URL}/login?email=${encodeURIComponent(email)}`;
  await sendEmail({
    to: email,
    subject: "You're invited to Needs Hub",
    text: `${name ? `Hi ${name},\n\n` : ""}You've been invited to Needs Hub as ${ROLE_LABEL[role]}${accountName ? ` for ${accountName}` : ""}.\n\nSign in with this email address (Google or a magic link): ${url}\n`,
  });
}

/** Sends the invitation email again (e.g. it was missed); the invitation itself is unchanged. */
export async function resendInvitation(actor: Actor, id: string) {
  assertAdmin(actor);
  const [row] = await getDb().select({ email: invitations.email, name: invitations.name, role: invitations.role, accountName: accounts.name })
    .from(invitations).leftJoin(accounts, eq(accounts.id, invitations.accountId))
    .where(and(eq(invitations.id, id), isNull(invitations.acceptedAt)));
  if (!row) throw new Error("Invitation not found or already accepted");
  await sendInvitationEmail({ email: row.email, name: row.name ?? "", role: row.role, accountName: row.accountName });
  return row.email;
}

export async function listPendingInvitations() {
  return getDb().select({ id: invitations.id, email: invitations.email, name: invitations.name, role: invitations.role, accountName: accounts.name, createdAt: invitations.createdAt })
    .from(invitations).leftJoin(accounts, eq(accounts.id, invitations.accountId))
    .where(isNull(invitations.acceptedAt)).orderBy(asc(invitations.createdAt));
}

export async function revokeInvitation(actor: Actor, id: string) {
  assertAdmin(actor);
  await getDb().delete(invitations).where(and(eq(invitations.id, id), isNull(invitations.acceptedAt)));
}
