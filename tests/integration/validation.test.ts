import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { seed } from "@/db/seed";
import { needs, tickets, users } from "@/db/schema";
import { saveUpload, readAttachment } from "@/domain/attachments";
import { loadActor, type SessionActor } from "@/domain/session";
import { customerTicket, customerActivity } from "@/domain/tracking";
import { confirmLooksGood, reviewRework, reworkRequests, submitRework, understandRework } from "@/domain/validation";

// After release the customer confirms it works, or reports what isn't right; the team decides.
let lena: SessionActor, dana: SessionActor, sam: SessionActor, mia: SessionActor, jo: SessionActor;
let t107: string, t101: string;

beforeAll(async () => {
  await seed({ quiet: true });
  const actor = async (name: string) => (await loadActor((await getDb().select({ id: users.id }).from(users).where(eq(users.name, name)))[0].id))!;
  [lena, dana, sam, mia, jo] = await Promise.all(["Lena Meyer", "Dana Ruiz", "Sam Kim", "Mia Chen", "Jo Osei"].map(actor));
  const key = async (k: string) => (await getDb().select({ id: tickets.id }).from(tickets).where(eq(tickets.key, k)))[0].id;
  [t107, t101] = [await key("T-107"), await key("T-101")];
});

afterAll(closeDb);

describe("customer validation and rework", () => {
  it("only asks once a ticket is released, and only its own customers", async () => {
    await expect(confirmLooksGood(lena, t101)).rejects.toThrow(/once it's released/);
    await expect(understandRework(dana, t107, { description: "Broken", attachmentIds: [] })).rejects.toThrow(/not found/);
  });

  it("AI reads the report (and a correction) into expected / actual / impact", async () => {
    const description = "I expected the import to update existing lanes. Instead it only adds new ones, so we have duplicates. We fix 200 lanes by hand.";
    const { understanding } = await understandRework(lena, t107, { description, attachmentIds: [] });
    expect(understanding.summary).toMatch(/^It looks like/);
    expect(understanding.expected).toMatch(/expected the import to update/);
    expect(understanding.actual).toMatch(/only adds new ones/);
    expect(understanding.impact).toMatch(/by hand/);

    const refined = await understandRework(lena, t107, { description, attachmentIds: [], correction: "Duplicated lanes break our rate lookups" });
    expect(refined.understanding.summary).toBe("It looks like duplicated lanes break our rate lookups.");
  });

  it("submits a rework request with a file; the team sees it, the customer can't change status", async () => {
    const file = await saveUpload(lena, { name: "duplicates.csv", type: "text/csv", size: 40, bytes: Buffer.from("lane,rate\nHAM-BER,10\nHAM-BER,12\n") });
    const context = { summary: "It looks like the import duplicates existing lanes.", expected: "Update existing lanes", actual: "Adds duplicates", impact: "Manual cleanup" };
    await submitRework(lena, t107, { description: "Duplicates after import", context, attachmentIds: [file.id] });
    await expect(submitRework(lena, t107, { description: "Again", context, attachmentIds: [] })).rejects.toThrow(/already reported/);

    const [forPm] = await reworkRequests(sam, { openOnly: true });
    expect(forPm).toMatchObject({ ticketId: t107, customer: "Lena Meyer", accountName: "Northwind Logistics", state: "open", context });
    expect(forPm.attachments.map((a) => a.filename)).toEqual(["duplicates.csv"]);

    // Staffing decides who on Engineering sees it, and who can open the file.
    expect(await reworkRequests(mia, { openOnly: true })).toHaveLength(1);
    expect(await reworkRequests(jo, { openOnly: true })).toHaveLength(0); // Jo is staffed on Contoso only
    expect(await readAttachment(mia, file.id)).not.toBeNull();
    expect(await readAttachment(jo, file.id)).toBeNull();
    await expect(reviewRework(jo, forPm.id, "reopen", "")).rejects.toThrow(/not found/);

    const view = (await customerTicket(lena, t107))!;
    expect(view.ticket.publicStatus).toBe("released"); // unchanged until the team decides
    expect(view.timeline.at(-1)!.body).toMatch(/Reported something isn't right/);
  });

  it("reopening moves the ticket back to In Development with the note, and reopens the Need", async () => {
    const [request] = await reworkRequests(sam, { openOnly: true });
    await expect(reviewRework(lena, request.id, "reopen", "")).rejects.toThrow(/not found/);
    await expect(reviewRework(sam, request.id, "decline", " ")).rejects.toThrow(/why/);

    await reviewRework(mia, request.id, "reopen", "Confirmed: re-importing duplicates lanes. Fixing it this week.");
    const view = (await customerTicket(lena, t107))!;
    expect(view.ticket.publicStatus).toBe("in_development");
    expect(view.timeline.at(-1)).toMatchObject({ publicStatus: "in_development", body: "Confirmed: re-importing duplicates lanes. Fixing it this week." });
    expect(view.validations[0]).toMatchObject({ state: "reopened" });
    const [{ needId }] = await getDb().select({ needId: tickets.needId }).from(tickets).where(eq(tickets.id, t107));
    expect((await getDb().select({ status: needs.status }).from(needs).where(eq(needs.id, needId)))[0].status).toBe("in_development");
    await expect(reviewRework(sam, request.id, "decline", "No")).rejects.toThrow(/already reviewed/);

    const activity = await customerActivity(lena);
    expect(activity.some((a) => a.text === "Bulk rate import from CSV moved to In Development.")).toBe(true);
  });

  it("declining tells the customer why; Looks good is recorded once", async () => {
    // Release again, then the customer reports, and the team declines.
    const { moveTicket } = await import("@/domain/delivery");
    const { projectWorkflow } = await import("@/domain/workflow");
    const [{ projectId }] = await getDb().select({ projectId: tickets.projectId }).from(tickets).where(eq(tickets.id, t107));
    const released = (await projectWorkflow(projectId)).find((s) => s.stage === "done")!;
    await moveTicket(sam, t107, released.id);

    const context = { summary: "It looks like the import is slow.", expected: "", actual: "", impact: "" };
    await submitRework(lena, t107, { description: "Slow", context, attachmentIds: [] });
    const [request] = await reworkRequests(sam, { openOnly: true });
    await reviewRework(sam, request.id, "decline", "Imports of 240 lanes take ~20s by design; we've added a progress bar.");
    const view = (await customerTicket(lena, t107))!;
    expect(view.ticket.publicStatus).toBe("released");
    expect(view.validations[0]).toMatchObject({ state: "declined", resolutionNote: "Imports of 240 lanes take ~20s by design; we've added a progress bar." });
    expect(view.timeline.at(-1)!.body).toMatch(/^We looked into your report/);

    await confirmLooksGood(lena, t107);
    await confirmLooksGood(lena, t107);
    expect((await customerTicket(lena, t107))!.validations.filter((v) => v.verdict === "looks_good")).toHaveLength(1);
  });
});
