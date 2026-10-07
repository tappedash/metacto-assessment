import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { accounts, invitations, users } from "@/db/schema";
import { seed } from "@/db/seed";
import {
  applyInvitation, canSignIn, inviteUser, listPendingInvitations, markInvitationAccepted, NotInvitedError, revokeInvitation,
} from "@/domain/invitations";
import { loadActor, type SessionActor } from "@/domain/session";

// Invitation-only onboarding (the rules Better Auth's user-create hook relies on).
const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";
let alex: SessionActor, sam: SessionActor;
let cedarId: string;

beforeAll(async () => {
  await seed({ quiet: true });
  const id = async (name: string) => (await getDb().select({ id: users.id }).from(users).where(eq(users.name, name)))[0].id;
  [alex, sam] = [(await loadActor(await id("Alex Lee")))!, (await loadActor(await id("Sam Kim")))!];
  cedarId = (await getDb().select({ id: accounts.id }).from(accounts).where(eq(accounts.name, "Cedar Clinics")))[0].id;
});
afterAll(closeDb);

describe("invitation-based onboarding", () => {
  it("lets only invited or existing people sign in", async () => {
    expect(await canSignIn("lena@northwind.example")).toBe(true); // existing user
    expect(await canSignIn("MAYA@cedar.example ")).toBe(true); // seeded pending invitation, any case
    expect(await canSignIn("stranger@example.com")).toBe(false);
  });

  it("creates the first sign-in from the invitation: role and client account", async () => {
    const data = await applyInvitation({ email: "Maya@Cedar.example", name: "" });
    expect(data).toMatchObject({ email: "maya@cedar.example", name: "Maya Ito", role: "client", accountId: cedarId });
    await expect(applyInvitation({ email: "stranger@example.com", name: "S" })).rejects.toBeInstanceOf(NotInvitedError);
  });

  it("lets the Admin invite (with an email) and revoke; nobody else can invite", async () => {
    await inviteUser(alex, { name: "Priya Nair", email: "Priya@Needs-Hub.local", role: "engineer", accountId: null });
    const pending = await listPendingInvitations();
    expect(pending.map((p) => p.email)).toContain("priya@needs-hub.local");

    const mail = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent("to:priya@needs-hub.local")}`)).json();
    expect(mail.messages[0].Subject).toBe("You're invited to Needs Hub");

    await expect(inviteUser(sam, { name: "X", email: "x@example.com", role: "pm", accountId: null })).rejects.toThrow(/Workspace Admin/);
    await expect(inviteUser(alex, { name: "", email: "lena@northwind.example", role: "client", accountId: cedarId })).rejects.toThrow(/already has access/);
    await expect(inviteUser(alex, { name: "", email: "c@example.com", role: "client", accountId: null })).rejects.toThrow(/client account/);

    const priya = pending.find((p) => p.email === "priya@needs-hub.local")!;
    await revokeInvitation(alex, priya.id);
    expect(await canSignIn("priya@needs-hub.local")).toBe(false);
  });

  it("marks the invitation accepted after the user is created", async () => {
    await markInvitationAccepted("maya@cedar.example");
    const [row] = await getDb().select().from(invitations).where(eq(invitations.email, "maya@cedar.example"));
    expect(row.acceptedAt).not.toBeNull();
    expect(await canSignIn("maya@cedar.example")).toBe(false); // accepted, and no user was created in this test
  });
});
