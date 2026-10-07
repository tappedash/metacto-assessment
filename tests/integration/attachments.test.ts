import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { seed } from "@/db/seed";
import { attachments, users } from "@/db/schema";
import { readAttachment, saveUpload } from "@/domain/attachments";
import { checkFeedback, contextToWhy, submitFeedback, understandFeedback } from "@/domain/feedback";
import { loadActor, type SessionActor } from "@/domain/session";

// Upload file -> AI extracts the problem -> customer confirms -> AI finds the Need -> support.
let lena: SessionActor, sam: SessionActor, ravi: SessionActor, jo: SessionActor, dana: SessionActor;

beforeAll(async () => {
  await seed({ quiet: true }); // fresh demo data for this file
  const actor = async (name: string) => (await loadActor((await getDb().select({ id: users.id }).from(users).where(eq(users.name, name)))[0].id))!;
  [lena, sam, ravi, jo, dana] = await Promise.all(["Lena Meyer", "Sam Kim", "Ravi Patel", "Jo Osei", "Dana Ruiz"].map(actor));
});
afterAll(closeDb);

const file = (path: string, type: string) => {
  const bytes = readFileSync(path);
  return { name: path.split("/").pop()!, type, size: bytes.length, bytes };
};

describe("client feedback with attachments", () => {
  let attachmentId: string;
  let requestId: string;

  it("reads an uploaded PDF and shows what AI understood", async () => {
    const view = await saveUpload(lena, file("docs/demo/weekly-report-process.pdf", "application/pdf"));
    attachmentId = view.id;
    expect(view).toMatchObject({ filename: "weekly-report-process.pdf", type: "PDF" });
    expect(view.summary).toMatch(/^This document appears to describe/);
  });

  it("rejects unsupported files", async () => {
    await expect(saveUpload(lena, { name: "run.exe", type: "application/octet-stream", size: 4, bytes: Buffer.from("MZ..") })).rejects.toThrow(/Upload a PDF/);
  });

  it("understands, matches after confirmation, and keeps the file as evidence", async () => {
    const { understanding } = await understandFeedback(lena, { title: "", details: "", attachmentIds: [attachmentId] });
    expect(understanding.summary).toMatch(/Is that the main problem\?/);
    const context = { summary: understanding.summary, goal: understanding.goal, workaround: understanding.workaround, impact: understanding.impact, terms: understanding.terms };

    const check = await checkFeedback({ title: understanding.title, why: contextToWhy(context) }, { skipFollowUp: true });
    if (check.kind !== "match") throw new Error("expected a match");
    expect(check.match.need?.title).toBe("Use product data outside the platform");

    const outcome = await submitFeedback(lena, { title: understanding.title, why: "", choice: "support", ...check.match, context, attachmentIds: [attachmentId] });
    expect(outcome.outcome).toBe("attached");
    requestId = outcome.requestId;
    const [row] = await getDb().select().from(attachments).where(eq(attachments.id, attachmentId));
    expect(row.requestId).toBe(requestId);
  });

  it("lets only the owner, the PM and staffed engineers open the file", async () => {
    expect(await readAttachment(lena, attachmentId)).not.toBeNull();
    expect(await readAttachment(sam, attachmentId)).not.toBeNull();
    expect(await readAttachment(ravi, attachmentId)).not.toBeNull(); // staffed on Northwind
    expect(await readAttachment(jo, attachmentId)).toBeNull(); // Contoso only
    expect(await readAttachment(dana, attachmentId)).toBeNull(); // another client
  });
});
