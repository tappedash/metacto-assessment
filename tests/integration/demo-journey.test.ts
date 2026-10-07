import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { seed } from "@/db/seed";
import { needs, notifications, projects, projectStatuses, requests, statusUpdates, tickets, users } from "@/db/schema";
import { approveAndSend, saveDecision } from "@/domain/decisions";
import { createTicket, moveTicket } from "@/domain/delivery";
import { checkFeedback, contextToWhy, submitFeedback, understandFeedback } from "@/domain/feedback";
import { loadActor, type SessionActor } from "@/domain/session";
import { addComment, customerTicket, publishUpdate, teamTimeline } from "@/domain/tracking";
import { acceptSuggestion, autoMatchedCount, listTriage } from "@/domain/triage";
import { confirmLooksGood } from "@/domain/validation";

// The assessment demo, end to end, through the same domain calls the screens use.
let lena: SessionActor, sam: SessionActor, ravi: SessionActor;
const db = () => getDb();
const inboxOf = async (userId: string) =>
  (await db().select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.channel, "in_app")))).map((n) => n.eventType);

beforeAll(async () => {
  await seed({ quiet: true });
  const actor = async (email: string) => (await loadActor((await db().select({ id: users.id }).from(users).where(eq(users.email, email)))[0].id))!;
  [lena, sam, ravi] = await Promise.all(["lena@northwind.example", "sam@needs-hub.local", "ravi@needs-hub.local"].map(actor));
});
afterAll(closeDb);

describe("demo journey", () => {
  let needId = "", ticketId = "";

  it("1-5: customer request → AI understanding → refine → match → support instead of a duplicate", async () => {
    const title = "Get our numbers into Excel";
    const details = "Our finance team copies shipping costs by hand into spreadsheets.";
    const first = await understandFeedback(lena, { title, details, attachmentIds: [] });
    expect(first.understanding.summary).toMatch(/^From your/);
    // Refine through conversation: the reply becomes part of the description.
    const refined = await understandFeedback(lena, { title, details: `${details}\nWe do this every Monday so we can reconcile invoices.`, attachmentIds: [] });
    expect(refined.understanding.goal).toMatch(/reconcile/);

    const before = await autoMatchedCount();
    const context = { summary: refined.understanding.summary, terms: refined.understanding.terms, goal: refined.understanding.goal, workaround: refined.understanding.workaround, impact: refined.understanding.impact };
    const check = await checkFeedback({ title, why: contextToWhy(context) }, { skipFollowUp: true });
    if (check.kind !== "match" || !check.match.need) throw new Error("expected a match");
    expect(check.match.need.title).toBe("Use product data outside the platform");
    const outcome = await submitFeedback(lena, { title, why: details, choice: "support", needId: check.match.needId, relation: check.match.relation, confidence: check.match.confidence, reason: check.match.reason, context });
    expect(outcome.outcome).toBe("attached");
    needId = outcome.needId!;
    expect(await autoMatchedCount()).toBe(before + 1); // 6: the PM sees it was handled automatically
    expect(await inboxOf(sam.id)).not.toContain("request.new");
  });

  it("7: PM reviews the one ambiguous request in Triage", async () => {
    const [item] = await listTriage();
    expect(item.title).toBe("Monthly audit report by email");
    await acceptSuggestion(sam, item.id);
    expect(await listTriage()).toEqual([]);
  });

  it("8: PM prioritises and decides; customers get the approved update", async () => {
    await saveDecision(sam, needId, { decision: "plan", priority: "P1", rationale: "Blocks weekly finance work for several clients.", rubricFinal: {} } as never);
    const [draft] = await db().select().from(statusUpdates).where(and(eq(statusUpdates.needId, needId), eq(statusUpdates.status, "planned")));
    await approveAndSend(sam, draft.id, { subject: "", body: "" });
    expect(await inboxOf(lena.id)).toContain("need.update_published");
  });

  it("9-11: ticket created and assigned; engineer progress; customer sees the public update", async () => {
    const [project] = await db().select().from(projects).where(eq(projects.name, "Reporting Modernization"));
    ({ id: ticketId } = await createTicket(sam, { needId, projectId: project.id, title: "Excel export for finance", priority: "P1", effort: "M", assigneeId: ravi.id }));
    expect(await inboxOf(ravi.id)).toContain("ticket.created");
    const status = async (name: string) => (await db().select().from(projectStatuses).where(and(eq(projectStatuses.projectId, project.id), eq(projectStatuses.name, name))))[0].id;

    await moveTicket(sam, ticketId, await status("Planned"));
    await moveTicket(ravi, ticketId, await status("In Development"));
    expect((await db().select().from(needs).where(eq(needs.id, needId)))[0].status).toBe("in_development");
    expect(await inboxOf(sam.id)).toContain("ticket.status");

    await addComment(ravi, ticketId, "Export works on staging; finance can try it next week.", "customer");
    const pending = (await teamTimeline(ticketId)).find((e) => e.kind === "comment")!;
    await publishUpdate(sam, pending.id);
    const view = (await customerTicket(lena, ticketId))!;
    expect(view.ticket.publicStatus).toBe("in_development");
    expect(view.timeline.map((e) => e.body)).toContain("Export works on staging; finance can try it next week.");
  });

  it("12: released → the customer validates", async () => {
    const [project] = await db().select({ id: tickets.projectId }).from(tickets).where(eq(tickets.id, ticketId));
    const [released] = await db().select().from(projectStatuses).where(and(eq(projectStatuses.projectId, project.id), eq(projectStatuses.stage, "done")));
    await moveTicket(ravi, ticketId, released.id);
    expect((await customerTicket(lena, ticketId))!.ticket.publicStatus).toBe("released");
    await confirmLooksGood(lena, ticketId);
    expect((await customerTicket(lena, ticketId))!.validations[0].verdict).toBe("looks_good");
    expect((await db().select().from(requests).where(eq(requests.title, "Monthly audit report by email")))[0].linkState).toBe("confirmed");
  });
});
