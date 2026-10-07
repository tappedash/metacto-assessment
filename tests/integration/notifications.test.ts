import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { seed } from "@/db/seed";
import { accounts, notifications, projectStatuses, tickets, users, workspaceSettings } from "@/db/schema";
import { moveTicket, updateTicket } from "@/domain/delivery";
import { submitFeedback } from "@/domain/feedback";
import { inbox, unreadCount } from "@/domain/notifications";
import { loadActor, type SessionActor } from "@/domain/session";
import { addComment, customerTicket, publishUpdate, teamTimeline } from "@/domain/tracking";
import { reviewRework, reworkRequests, submitRework } from "@/domain/validation";

// Event notifications: the right people, on the channels they allow, with an audit row each time.
let sam: SessionActor, ravi: SessionActor, mia: SessionActor, lena: SessionActor, dana: SessionActor;
const db = () => getDb();
const ticket = async (key: string) => (await db().select().from(tickets).where(eq(tickets.key, key)))[0];
const status = async (projectId: string, name: string) =>
  (await db().select().from(projectStatuses).where(and(eq(projectStatuses.projectId, projectId), eq(projectStatuses.name, name))))[0].id;
const events = async (userId: string, channel: "in_app" | "email" = "in_app") =>
  (await db().select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.channel, channel))))
    .map((n) => `${n.eventType}:${n.status}`);

beforeAll(async () => {
  await seed({ quiet: true });
  const actor = async (email: string) => (await loadActor((await db().select({ id: users.id }).from(users).where(eq(users.email, email)))[0].id))!;
  [sam, ravi, mia, lena, dana] = await Promise.all(["sam@needs-hub.local", "ravi@needs-hub.local", "mia@needs-hub.local", "lena@northwind.example", "dana@contoso.example"].map(actor));
});
beforeEach(async () => { await db().delete(notifications); });
afterAll(closeDb);

describe("event notifications", () => {
  it("tells the responsible PM about genuinely new requests, not about confirmed matches", async () => {
    const base = { title: "Carbon report per shipment", why: "Our sustainability team needs CO2 per lane.", relation: "new" as const, confidence: 0.6, reason: "No match", needId: null };
    await submitFeedback(lena, { ...base, choice: "different" });
    const [n] = await inbox(sam.id);
    expect(n).toMatchObject({ eventType: "request.new", href: "/pm/triage", title: "New request from Northwind Logistics: Carbon report per shipment" });
    expect(n.body).toContain("AI interpretation: No match");
    expect(await events(sam.id, "email")).toEqual(["request.new:sent"]);

    await db().delete(notifications);
    const exportNeed = (await ticket("T-101")).needId;
    await submitFeedback(dana, { ...base, title: "Excel export", choice: "support", relation: "same", needId: exportNeed, confidence: 0.9 });
    expect(await events(sam.id)).toEqual([]);
  });

  it("routes a request to the account's responsible PM when one is set", async () => {
    const [other] = await db().insert(users).values({ name: "Pat PM", email: "pat@needs-hub.local", role: "pm" }).returning();
    const [northwind] = await db().select().from(accounts).where(eq(accounts.name, "Northwind Logistics"));
    await db().update(accounts).set({ ownerPmId: other.id }).where(eq(accounts.id, northwind.id));
    await submitFeedback(lena, { title: "Driver app offline mode", why: "No signal in rural depots.", relation: "new", confidence: 0.6, reason: "No match", needId: null, choice: "different" });
    expect(await events(other.id)).toEqual(["request.new:sent"]);
    expect(await events(sam.id)).toEqual([]);
    await db().update(accounts).set({ ownerPmId: null }).where(eq(accounts.id, northwind.id));
  });

  it("status moves reach the PM and assignee; customers only on a public change", async () => {
    const t = await ticket("T-104"); // Identity Modernization (Contoso), assigned to Ravi
    await moveTicket(ravi, t.id, await status(t.projectId, "UAT")); // In Development -> Ready for Review
    expect(await events(sam.id)).toEqual(["ticket.status:sent"]);
    expect(await events(ravi.id)).toEqual([]); // never about your own action
    expect((await inbox(dana.id))[0]).toMatchObject({ title: "SAML SSO for the admin console moved to Ready for Review", href: `/client/tickets/${t.id}` });

    await db().delete(notifications);
    await moveTicket(ravi, t.id, await status(t.projectId, "Client sign-off")); // still Ready for Review
    expect(await events(dana.id)).toEqual([]);
    expect(await events(sam.id)).toEqual(["ticket.status:sent"]);
  });

  it("respects the Admin's customer toggles", async () => {
    await db().update(workspaceSettings).set({ customerNotify: { planned: true, in_development: true, ready_for_review: true, released: false, rework_decision: true } });
    const t = await ticket("T-104");
    await moveTicket(sam, t.id, await status(t.projectId, "Live"));
    expect(await events(dana.id)).toEqual([]);
    expect(await events(ravi.id)).toEqual(["ticket.released:sent"]);
    await db().update(workspaceSettings).set({ customerNotify: { planned: true, in_development: true, ready_for_review: true, released: true, rework_decision: true } });
  });

  it("engineers' customer updates wait for the PM; publishing notifies the customers", async () => {
    const t = await ticket("T-101"); // Northwind, Ravi staffed
    await addComment(ravi, t.id, "CSV export is on staging; we'll share it next week.", "customer");
    expect(await events(sam.id)).toEqual(["ticket.update_pending:sent"]);
    expect(await events(lena.id)).toEqual([]);
    expect((await customerTicket(lena, t.id))!.timeline.map((e) => e.body)).not.toContain("CSV export is on staging; we'll share it next week.");

    const pending = (await teamTimeline(t.id)).find((e) => e.body === "CSV export is on staging; we'll share it next week.")!;
    await expect(publishUpdate(ravi, pending.id)).rejects.toThrow(/Product Manager/);
    await publishUpdate(sam, pending.id);
    expect((await customerTicket(lena, t.id))!.timeline.map((e) => e.body)).toContain("CSV export is on staging; we'll share it next week.");
    expect(await events(lena.id)).toEqual(["ticket.update_published:sent"]);
    expect(await events(ravi.id)).toEqual(["ticket.update_published:sent"]); // the author hears it went out
  });

  it("assignment and priority changes reach the right people", async () => {
    const t = await ticket("T-101");
    await updateTicket(sam, t.id, { assigneeId: mia.id, priority: "P0" });
    expect(await events(mia.id)).toEqual(expect.arrayContaining(["ticket.assigned:sent", "ticket.priority:sent"]));
    await expect(updateTicket(ravi, t.id, { assigneeId: ravi.id, priority: null })).rejects.toThrow(/Product Manager/);
    await updateTicket(sam, t.id, { assigneeId: ravi.id, priority: "P1" });
  });

  it("rework requests reach the assignee and PM; the decision reaches the customer and assignee", async () => {
    const t = await ticket("T-107"); // Released, assigned to Mia
    const context = { summary: "It looks like duplicates appear.", expected: "", actual: "", impact: "" };
    await submitRework(lena, t.id, { description: "Duplicates", context, attachmentIds: [] });
    expect(await events(mia.id)).toEqual(["rework.submitted:sent"]);
    expect(await events(sam.id)).toEqual(["rework.submitted:sent"]);

    await db().delete(notifications);
    const [request] = await reworkRequests(sam, { openOnly: true });
    await reviewRework(sam, request.id, "follow_up", "We'll fix duplicates in a follow-up.");
    expect(await events(lena.id)).toEqual(["rework.resolved:sent"]);
    expect(await events(mia.id)).toEqual(expect.arrayContaining(["rework.resolved:sent", "ticket.created:sent"]));
    const followUp = (await db().select().from(tickets).where(eq(tickets.title, "Follow-up: Bulk rate import from CSV")))[0];
    expect((await customerTicket(lena, followUp.id))!.ticket.publicStatus).toBe("planned");
  });

  it("follows each user's preferences, but assignments always reach the inbox", async () => {
    await db().update(users).set({ notifyEmail: false, notifyInApp: false }).where(eq(users.id, mia.id));
    const t = await ticket("T-103");
    await updateTicket(sam, t.id, { assigneeId: mia.id, priority: t.priority });
    expect(await events(mia.id)).toEqual(["ticket.assigned:sent"]);
    expect(await events(mia.id, "email")).toEqual(["ticket.assigned:skipped"]);
    expect(await unreadCount(mia.id)).toBe(1);
    await db().update(users).set({ notifyEmail: true, notifyInApp: true }).where(eq(users.id, mia.id));
  });
});
