import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { seed } from "@/db/seed";
import { needs, projectStatuses, requests, statusUpdates, supports, tickets, users } from "@/db/schema";
import { approveAndSend, ensureNeedInsights, saveDecision } from "@/domain/decisions";
import { moveTicket } from "@/domain/delivery";
import { checkFeedback, submitFeedback } from "@/domain/feedback";
import { needSignals, sentUpdates } from "@/domain/needs";
import { toPublicNeed } from "@/domain/permissions";
import { loadActor, type SessionActor } from "@/domain/session";
import { acceptSuggestion, listTriage } from "@/domain/triage";

// The full user story, end to end, against the seeded database and Mailpit
// (run via `npm run test:integration`, which reseeds first; AI_PROVIDER=mock):
// client submits -> AI asks why -> AI matches -> client supports -> evidence ->
// PM triage untouched -> AI Brief + rubric -> PM decides -> AI drafts update ->
// PM approves -> email delivered -> client sees progress -> engineer delivers.

const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";
let lena: SessionActor, sam: SessionActor, ravi: SessionActor;
let exportNeedId: string;
const stamp = Date.now().toString(36);

async function actor(name: string) {
  const [u] = await getDb().select({ id: users.id }).from(users).where(eq(users.name, name));
  return (await loadActor(u.id))!;
}

async function mailpitMessages(subject: string): Promise<{ To: { Address: string }[]; Subject: string }[]> {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`subject:"${subject}"`)}`);
  return (await res.json()).messages ?? [];
}

beforeAll(async () => {
  await seed({ quiet: true }); // fresh demo data for this file
  [lena, sam, ravi] = await Promise.all([actor("Lena Meyer"), actor("Sam Kim"), actor("Ravi Patel")]);
  const [n] = await getDb().select({ id: needs.id }).from(needs).where(eq(needs.title, "Use product data outside the platform"));
  exportNeedId = n.id;
});

afterAll(closeDb);

describe("end-to-end workflow", () => {
  it("1. client submits 'Export dashboard to Excel'; AI asks why when it's missing", async () => {
    const result = await checkFeedback({ title: "Export dashboard to Excel", why: "" });
    expect(result.kind).toBe("follow_up");
  });

  let requestId: string;
  it("2. AI matches the existing Customer Need and the client supports it", async () => {
    const input = { title: "Export dashboard to Excel", why: `Finance reconciles shipping costs in spreadsheets every Monday (${stamp}).` };
    const before = (await needSignals([exportNeedId])).get(exportNeedId)!;
    const check = await checkFeedback(input);
    expect(check.kind).toBe("match");
    if (check.kind !== "match") return;
    expect(check.match.need?.title).toBe("Use product data outside the platform");
    expect(["same", "related"]).toContain(check.match.relation);

    const outcome = await submitFeedback(lena, { ...input, choice: "support", ...check.match });
    expect(outcome).toMatchObject({ outcome: "attached", needId: exportNeedId });
    requestId = outcome.requestId;

    // Feedback became evidence and demand; the client is a supporter.
    const after = (await needSignals([exportNeedId])).get(exportNeedId)!;
    expect(after.requests).toBe(before.requests + 1);
    const [support] = await getDb().select().from(supports).where(and(eq(supports.userId, lena.id), eq(supports.needId, exportNeedId)));
    expect(support).toBeTruthy();
  });

  it("3. PM triage only holds uncertain cases (the confirmed match is not there)", async () => {
    expect((await listTriage()).some((t) => t.id === requestId)).toBe(false);
  });

  let updateId: string;
  it("4. AI Brief + rubric cite real evidence; PM sets priority and rationale; AI drafts an update", async () => {
    const insights = await ensureNeedInsights(exportNeedId, sam, { force: true });
    const evidenceIds = new Set((await getDb().select({ id: requests.id }).from(requests).where(eq(requests.needId, exportNeedId))).map((r) => r.id));
    expect(insights.brief.keyPoints.length).toBeGreaterThan(0);
    for (const k of insights.brief.keyPoints) for (const c of k.citations) expect(evidenceIds.has(c)).toBe(true);
    expect(insights.rubric.criteria.map((c) => c.key).sort()).toEqual(["reach", "revenue_impact", "severity", "strategic_fit"]);

    await expect(saveDecision(sam, exportNeedId, { decision: "plan", priority: "P1", rationale: "  ", rubricFinal: {} })).rejects.toThrow(/rationale/i);
    await expect(saveDecision(ravi, exportNeedId, { decision: "plan", priority: "P1", rationale: "x", rubricFinal: {} })).rejects.toThrow(/Product Manager/);

    const result = await saveDecision(sam, exportNeedId, {
      decision: "plan", priority: "P1", rationale: "Blocks weekly finance workflows for several accounts; CSV export first.",
      rubricFinal: { reach: 4, revenue_impact: 4, strategic_fit: 3, severity: 5, effort: 3 },
    });
    expect(result.updateId).toBeTruthy();
    updateId = result.updateId!;
    const [need] = await getDb().select().from(needs).where(eq(needs.id, exportNeedId));
    expect(need).toMatchObject({ status: "planned", priority: "P1" });
  });

  it("5. PM approves the draft; customers get the email (Mailpit); the client sees progress", async () => {
    const subject = `Planned: CSV export for every report (${stamp})`;
    const result = await approveAndSend(sam, updateId, { subject, body: "We're shipping CSV export for every dashboard report first." });
    expect(result.failed).toEqual([]);
    expect(result.sent).toBeGreaterThan(0);

    const delivered = await mailpitMessages(subject);
    expect(delivered.flatMap((m) => m.To.map((t) => t.Address))).toContain("lena@northwind.example");

    const visible = await sentUpdates(exportNeedId);
    expect(visible[0].subject).toBe(subject);
    const [record] = await getDb().select().from(needs).where(eq(needs.id, exportNeedId));
    expect(Object.keys(toPublicNeed(record, 3))).not.toContain("rubricFinal");
  });

  it("6. engineer delivers: starting the first ticket moves the Need to In Development and drafts an update", async () => {
    const [t101] = await getDb().select().from(tickets).where(eq(tickets.key, "T-101"));
    const [t102] = await getDb().select().from(tickets).where(eq(tickets.key, "T-102"));
    const status = async (projectId: string, name: string) =>
      (await getDb().select().from(projectStatuses).where(and(eq(projectStatuses.projectId, projectId), eq(projectStatuses.name, name))))[0].id;
    await expect(moveTicket(ravi, t102.id, await status(t102.projectId, "Planned"))).rejects.toThrow(); // out of Backlog is a PM decision
    const { needStatusChanged } = await moveTicket(ravi, t101.id, await status(t101.projectId, "In Development"));
    expect(needStatusChanged).toBe("in_development");
    const drafts = await getDb().select().from(statusUpdates).where(and(eq(statusUpdates.needId, exportNeedId), eq(statusUpdates.status, "in_development")));
    expect(drafts.some((d) => d.approvedBy === null)).toBe(true);
  });

  it("7. 'No, mine is different' goes to PM triage; the PM accepts the AI suggestion", async () => {
    const input = { title: "Google Sheets reporting", why: `Live sync for our ops dashboards (${stamp}).` };
    const check = await checkFeedback(input);
    if (check.kind !== "match") throw new Error("expected a match");
    const outcome = await submitFeedback(lena, { ...input, choice: "different", ...check.match });
    expect(outcome.outcome).toBe("triage");
    const item = (await listTriage()).find((t) => t.id === outcome.requestId);
    expect(item?.suggestedNeedTitle).toBe("Use product data outside the platform");

    await acceptSuggestion(sam, outcome.requestId);
    expect((await listTriage()).some((t) => t.id === outcome.requestId)).toBe(false);
  });
});
