import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { seed } from "@/db/seed";
import { notifications, tickets, users } from "@/db/schema";
import { createProject, setStaffing } from "@/domain/admin";
import { createTicket, getTicket, listTickets, moveTicket, saveTicketNotes, updateTicket } from "@/domain/delivery";
import { saveDecision } from "@/domain/decisions";
import { needEvidence } from "@/domain/needs";
import { loadActor, type SessionActor } from "@/domain/session";
import { addComment, customerTicket, customerTickets } from "@/domain/tracking";

// Final audit: what each role may see and do is enforced in the domain layer, whatever the UI shows.
let sam: SessionActor, ravi: SessionActor, mia: SessionActor, jo: SessionActor, lena: SessionActor, dana: SessionActor, alex: SessionActor;
const db = () => getDb();
const ticket = async (key: string) => (await db().select().from(tickets).where(eq(tickets.key, key)))[0];

beforeAll(async () => {
  await seed({ quiet: true });
  const actor = async (email: string) => (await loadActor((await db().select({ id: users.id }).from(users).where(eq(users.email, email)))[0].id))!;
  [sam, ravi, mia, jo, lena, dana, alex] = await Promise.all(
    ["sam@needs-hub.local", "ravi@needs-hub.local", "mia@needs-hub.local", "jo@needs-hub.local", "lena@northwind.example", "dana@contoso.example", "alex@needs-hub.local"].map(actor));
});
afterAll(closeDb);

describe("client", () => {
  it("sees only own-account tickets on Needs they follow, and only published customer entries", async () => {
    const own = (await customerTickets(lena)).tickets.map((t) => t.title);
    expect(own).not.toContain("SAML SSO for the admin console"); // Contoso's
    expect(await customerTicket(lena, (await ticket("T-104")).id)).toBeNull();
    expect(await customerTicket(dana, (await ticket("T-101")).id)).toBeNull();
    const t103 = await ticket("T-103"); // Contoso, has an engineer update awaiting PM approval
    const bodies = JSON.stringify(await customerTicket(dana, t103.id));
    expect(bodies).not.toContain("auditors listed"); // pending, not published
  });

  it("can't act as the team", async () => {
    const t = await ticket("T-101");
    await expect(addComment(lena, t.id, "hi", "customer")).rejects.toThrow();
    await expect(moveTicket(lena, t.id, t.statusId)).rejects.toThrow();
    await expect(saveTicketNotes(lena, t.id, { effort: "S", feasibility: "", dependencies: "", notes: "" })).rejects.toThrow();
    await expect(saveDecision(lena, t.needId, { decision: "plan", priority: "P1", rationale: "x", rubricFinal: {} } as never)).rejects.toThrow();
  });
});

describe("engineer", () => {
  it("sees tickets and evidence only for staffed clients", async () => {
    const keys = (await listTickets(jo)).map((t) => t.key); // Jo: Contoso only
    expect(keys).toEqual(expect.arrayContaining(["T-103", "T-104"]));
    expect(keys).not.toContain("T-101");
    expect(await getTicket(jo, (await ticket("T-101")).id)).toBeNull();
    const ev = await needEvidence((await ticket("T-101")).needId, jo);
    expect(ev.visible.every((e) => jo.staffedAccountIds!.includes(e.accountId))).toBe(true);
    expect(ev.hiddenCount).toBeGreaterThan(0);
  });

  it("moves only own tickets, and loses notes access when unstaffed", async () => {
    const t107 = await ticket("T-107"); // Mia's
    await expect(moveTicket(ravi, t107.id, t107.statusId)).rejects.toThrow();
    await setStaffing(alex, mia.id, lena.accountId!, false); // T-107 is a Northwind ticket
    const miaNow = (await loadActor(mia.id))!;
    await expect(saveTicketNotes(miaNow, t107.id, { effort: "S", feasibility: "", dependencies: "", notes: "x" })).rejects.toThrow(/assignee or the PM/);
  });
});

describe("PM and Admin", () => {
  it("PM owns product decisions; others can't triage or create tickets", async () => {
    const t = await ticket("T-101");
    await expect(createTicket(ravi, { needId: t.needId, projectId: t.projectId, title: "x", priority: null, effort: null, assigneeId: null })).rejects.toThrow(/Product Manager/);
    await expect(createTicket(alex, { needId: t.needId, projectId: t.projectId, title: "x", priority: null, effort: null, assigneeId: null })).rejects.toThrow(/Product Manager/);
  });

  it("tickets can only be assigned to engineers staffed on that client", async () => {
    const t = await ticket("T-104"); // Contoso
    await expect(updateTicket(sam, t.id, { assigneeId: lena.id, priority: t.priority })).rejects.toThrow(/active engineer/);
    const before = await db().select().from(notifications);
    await expect(updateTicket(sam, t.id, { assigneeId: mia.id, priority: t.priority })).rejects.toThrow(/staffed/);
    expect((await db().select().from(notifications)).length).toBe(before.length); // nobody notified
  });

  it("only the Admin manages workspace structure", async () => {
    await expect(createProject(sam, { name: "x", accountId: lena.accountId!, status: "active" })).rejects.toThrow(/Workspace Admin/);
    await expect(setStaffing(sam, jo.id, lena.accountId!, true)).rejects.toThrow(/Workspace Admin/);
  });
});
