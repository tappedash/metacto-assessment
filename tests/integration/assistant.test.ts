import { readFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { seed } from "@/db/seed";
import { needs, requests, users } from "@/db/schema";
import { saveUpload } from "@/domain/attachments";
import { askAssistant, buildContext } from "@/domain/assistant";
import { approveAndSend, saveDecision } from "@/domain/decisions";
import { checkFeedback, submitFeedback } from "@/domain/feedback";
import { loadActor, type SessionActor } from "@/domain/session";

// "Ask Needs Hub": grounded answers from the customer's own data, no leaks, no auto-submit.
let lena: SessionActor, sam: SessionActor;
let exportId: string, darkId: string;

beforeAll(async () => {
  await seed({ quiet: true }); // fresh demo data for this file
  const actor = async (name: string) => (await loadActor((await getDb().select({ id: users.id }).from(users).where(eq(users.name, name)))[0].id))!;
  [lena, sam] = await Promise.all([actor("Lena Meyer"), actor("Sam Kim")]);
  const need = async (title: string) => (await getDb().select({ id: needs.id }).from(needs).where(eq(needs.title, title)))[0].id;
  [exportId, darkId] = await Promise.all([need("Use product data outside the platform"), need("Dark mode for the dashboard")]);

  // Story setup: Lena's Excel request is grouped; the PM plans it and approves an update.
  const input = { title: "Export dashboard to Excel", why: "Finance reconciles shipment costs in spreadsheets every Monday." };
  const check = await checkFeedback(input, { skipFollowUp: true });
  if (check.kind === "match") await submitFeedback(lena, { ...input, choice: "support", ...check.match });
  const { updateId } = await saveDecision(sam, exportId, { decision: "plan", priority: "P1", rationale: "Blocks weekly finance work; CSV export first.", rubricFinal: {} });
  if (updateId) await approveAndSend(sam, updateId, { subject: "Planned: CSV export for every report", body: "We're shipping CSV export for every dashboard report first." });
  await saveDecision(sam, darkId, { decision: "not_planned", priority: null, rationale: "We're focusing on reporting and security needs that block daily work.", rubricFinal: {} });
});

afterAll(closeDb);

describe("client assistant", () => {
  it("explains what happened to my Excel request", async () => {
    const r = await askAssistant(lena, { question: "What happened to my Excel request?", history: [] });
    expect(r.answer).toMatch(/grouped under "Use product data outside the platform".*Planned/);
    expect(r.links.map((l) => l.href)).toContain(`/client/needs/${exportId}`);
  });

  it("gives the latest approved update on the current page's Need", async () => {
    const r = await askAssistant(lena, { question: "What's the latest update?", history: [], pageNeedId: exportId });
    expect(r.answer).toMatch(/Planned: CSV export for every report/);
  });

  it("explains a Not Planned decision with the public rationale", async () => {
    const r = await askAssistant(lena, { question: "Why was this marked Not Planned?", history: [], pageNeedId: darkId });
    expect(r.answer).toMatch(/Not Planned.*focusing on reporting and security/);
  });

  it("lists my requests and supported needs", async () => {
    expect((await askAssistant(lena, { question: "What requests have I submitted?", history: [] })).answer).toMatch(/Export dashboard to Excel/);
    expect((await askAssistant(lena, { question: "What needs am I supporting?", history: [] })).answer).toMatch(/Use product data outside the platform/);
  });

  it("says so when there's no approved update instead of inventing one", async () => {
    const delays = (await getDb().select({ id: needs.id }).from(needs).where(eq(needs.title, "Know about delays before customers do")))[0].id;
    const r = await askAssistant(lena, { question: "What's the latest update?", history: [], pageNeedId: delays });
    expect(r.answer).toMatch(/couldn't find an approved update/);
  });

  it("never sees other customers, contract values or internal scores", async () => {
    const ctx = JSON.stringify(await buildContext(lena, { question: "Do you already have feedback about CSV export?", history: [] }));
    for (const secret of ["Fabrikam", "Contoso", "Omar", "Dana", "contract", "rubric", "aiBrief", "priority", "internal", "420000"]) {
      expect(ctx).not.toContain(secret);
    }
  });

  it("reads a shared file, suggests the matching Need, and submits nothing", async () => {
    const before = (await getDb().select({ n: sql<number>`count(*)::int` }).from(requests).where(eq(requests.submittedBy, lena.id)))[0].n;
    const bytes = readFileSync("docs/demo/weekly-report-process.pdf");
    const file = await saveUpload(lena, { name: "weekly-report-process.pdf", type: "application/pdf", size: bytes.length, bytes });
    const r = await askAssistant(lena, { question: "Can you take a look at this file?", history: [], attachmentId: file.id });
    expect(r.answer).toMatch(/Use product data outside the platform/);
    expect(r.links.map((l) => l.label)).toEqual(expect.arrayContaining(["View matching Need", "Share this as feedback", "Open attachment"]));
    const after = (await getDb().select({ n: sql<number>`count(*)::int` }).from(requests).where(and(eq(requests.submittedBy, lena.id)))).at(0)!.n;
    expect(after).toBe(before);
  });
});
