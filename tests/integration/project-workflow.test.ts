import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { seed } from "@/db/seed";
import { projects, tickets, users } from "@/db/schema";
import { createTicket } from "@/domain/delivery";
import { loadActor, type SessionActor } from "@/domain/session";
import { addStatus, moveStatus, projectWorkflow, removeStatus, updateStatus } from "@/domain/workflow";

// The PM configures a project's ticket statuses; rules keep the workflow usable.
let sam: SessionActor, ravi: SessionActor;
let projectId: string;
const names = async () => (await projectWorkflow(projectId)).map((s) => `${s.name}/${s.stage}`);

beforeAll(async () => {
  await seed({ quiet: true }); // fresh demo data for this file
  const id = async (name: string) => (await getDb().select({ id: users.id }).from(users).where(eq(users.name, name)))[0].id;
  [sam, ravi] = [(await loadActor(await id("Sam Kim")))!, (await loadActor(await id("Ravi Patel")))!];
  [{ id: projectId }] = await getDb().select({ id: projects.id }).from(projects).where(eq(projects.name, "Carrier Automation"));
});

afterAll(closeDb);

describe("per-project ticket workflow", () => {
  it("starts from the default workflow", async () => {
    expect(await names()).toEqual(["Backlog/backlog", "Planned/planned", "In Development/in_progress", "Released/done"]);
  });

  it("lets the PM add, rename and reorder statuses (within their stage)", async () => {
    await addStatus(sam, projectId, "In QA", "in_progress");
    await addStatus(sam, projectId, "Ready", "planned");
    expect(await names()).toEqual(["Backlog/backlog", "Planned/planned", "Ready/planned", "In Development/in_progress", "In QA/in_progress", "Released/done"]);

    const qa = (await projectWorkflow(projectId)).find((s) => s.name === "In QA")!;
    await moveStatus(sam, qa.id, "up");
    await updateStatus(sam, qa.id, { name: "Code review", stage: "in_progress" });
    expect(await names()).toEqual(["Backlog/backlog", "Planned/planned", "Ready/planned", "Code review/in_progress", "In Development/in_progress", "Released/done"]);
    await expect(moveStatus(sam, qa.id, "up")).rejects.toThrow(/within their stage/);
  });

  it("only lets the PM configure statuses", async () => {
    await expect(addStatus(ravi, projectId, "Hack", "planned")).rejects.toThrow(/Product Manager/);
  });

  it("protects the rules: unique names, keep a Backlog and a Done status", async () => {
    await expect(addStatus(sam, projectId, "planned", "planned")).rejects.toThrow(/unique/);
    const released = (await projectWorkflow(projectId)).find((s) => s.stage === "done")!;
    await expect(removeStatus(sam, released.id, null)).rejects.toThrow(/Done/);
  });

  it("asks where tickets go when their status is removed, then moves them", async () => {
    const backlog = (await projectWorkflow(projectId)).find((s) => s.name === "Backlog")!;
    const t = await createTicket(sam, { needId: (await getDb().select({ id: tickets.needId }).from(tickets).limit(1))[0].id, projectId, title: "Workflow test ticket", priority: null, effort: null, assigneeId: null });
    const ready = (await projectWorkflow(projectId)).find((s) => s.name === "Ready")!;
    await getDb().update(tickets).set({ statusId: ready.id }).where(eq(tickets.id, t.id));
    await expect(removeStatus(sam, ready.id, null)).rejects.toThrow(/Choose where/);
    await removeStatus(sam, ready.id, backlog.id);
    const [moved] = await getDb().select({ statusId: tickets.statusId }).from(tickets).where(eq(tickets.id, t.id));
    expect(moved.statusId).toBe(backlog.id);
    expect(await names()).not.toContain("Ready/planned");
  });
});
