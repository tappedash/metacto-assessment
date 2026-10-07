import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { seed } from "@/db/seed";
import { projectStatuses, tickets, users } from "@/db/schema";
import { moveTicket } from "@/domain/delivery";
import { loadActor, type SessionActor } from "@/domain/session";
import { addComment, customerActivity, customerTicket, customerTickets, teamTimeline } from "@/domain/tracking";

// Customers track delivery of the Needs they follow, without seeing internal detail.
let lena: SessionActor, dana: SessionActor, omar: SessionActor, ravi: SessionActor, sam: SessionActor;
const ticketId = async (key: string) => (await getDb().select({ id: tickets.id }).from(tickets).where(eq(tickets.key, key)))[0].id;

beforeAll(async () => {
  await seed({ quiet: true });
  const actor = async (name: string) => (await loadActor((await getDb().select({ id: users.id }).from(users).where(eq(users.name, name)))[0].id))!;
  [lena, dana, omar, ravi, sam] = await Promise.all(["Lena Meyer", "Dana Ruiz", "Omar Haddad", "Ravi Patel", "Sam Kim"].map(actor));
});

afterAll(closeDb);

describe("customer delivery tracking", () => {
  it("shows a client only their own company's tickets past Backlog; other clients are a count", async () => {
    const { tickets: mine, otherProjects } = await customerTickets(lena);
    expect(mine.map((t) => t.title).sort()).toEqual(["Bulk rate import from CSV", "CSV export for dashboard reports"]);
    const exportNeed = mine.find((t) => t.title.startsWith("CSV export"))!.needId;
    expect(otherProjects.get(exportNeed)).toBe(2); // Contoso's two export tickets, not described

    // Omar follows the export Need but his company has no project: nothing to track.
    expect((await customerTickets(omar)).tickets).toEqual([]);
  });

  it("maps internal statuses to the four public ones", async () => {
    const byTitle = new Map((await customerTickets(lena)).tickets.map((t) => [t.title, t.publicStatus]));
    expect(byTitle.get("CSV export for dashboard reports")).toBe("planned");
    expect(byTitle.get("Bulk rate import from CSV")).toBe("released");
    const [sso] = (await customerTickets(dana)).tickets;
    expect(sso.publicStatus).toBe("in_development"); // "Security review" is still In Development to the customer
  });

  it("hides internal comments and other clients' tickets", async () => {
    const id = await ticketId("T-101");
    await addComment(sam, id, "Internal: waiting on pagination fix.", "internal");
    await addComment(sam, id, "Export will cover every dashboard report.", "customer");
    const view = (await customerTicket(lena, id))!;
    const bodies = view.timeline.map((e) => e.body);
    expect(bodies).toContain("Export will cover every dashboard report.");
    expect(bodies).not.toContain("Internal: waiting on pagination fix.");
    expect((await teamTimeline(id)).map((e) => e.body)).toContain("Internal: waiting on pagination fix.");

    expect(await customerTicket(lena, await ticketId("T-103"))).toBeNull(); // Contoso's ticket
    expect(await customerTicket(dana, id)).toBeNull();
  });

  it("only lets the PM and staffed engineers comment", async () => {
    await expect(addComment(lena, await ticketId("T-101"), "Hello", "customer")).rejects.toThrow(/PM and engineers/);
  });

  it("tells the customer when the public status changes, and only then", async () => {
    const id = await ticketId("T-104");
    const [{ projectId }] = await getDb().select({ projectId: tickets.projectId }).from(tickets).where(eq(tickets.id, id));
    const statuses = await getDb().select().from(projectStatuses).where(eq(projectStatuses.projectId, projectId));
    const named = (name: string) => statuses.find((s) => s.name === name)!.id;

    const before = (await customerTicket(dana, id))!.timeline.length;
    await moveTicket(ravi, id, named("UAT"));
    const after = (await customerTicket(dana, id))!;
    expect(after.ticket.publicStatus).toBe("ready_for_review");
    expect(after.timeline.length).toBe(before + 1);
    expect(after.timeline.at(-1)!.publicStatus).toBe("ready_for_review");

    // Back to Build: In Development is a public change; Build → Security review isn't.
    await moveTicket(sam, id, named("Build"));
    const mid = (await customerTicket(dana, id))!.timeline.length;
    await moveTicket(sam, id, named("Security review"));
    expect((await customerTicket(dana, id))!.timeline.length).toBe(mid);

    const activity = await customerActivity(dana);
    expect(activity.some((a) => a.text === "SAML SSO for the admin console moved to Ready for Review.")).toBe(true);
  });
});
