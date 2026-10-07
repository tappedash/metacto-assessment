// Matching evaluation: runs the product's own pipeline (embedding -> pgvector top-5 ->
// structured classification) on curated cases against the seeded Customer Needs.
//
//   npm run eval:matching                       # deterministic mock (no key)
//   AI_PROVIDER=openai npm run eval:matching    # real OpenAI (seed with the same provider first)
//
// Read-only: nothing is written to the database.
import { readFileSync } from "node:fs";
import { loadEnv } from "@/lib/env-loader";

interface Case { id: string; kind: string; title: string; why: string; expected: "same" | "related" | "new"; expectedNeed: string | null }

async function main() {
  loadEnv();
  const [{ getAi }, { closeDb, getDb }, { matchRequest }, { getSettings }, { needs }] = await Promise.all([
    import("@/ai"), import("@/db/client"), import("@/domain/matching"), import("@/domain/settings"), import("@/db/schema"),
  ]);
  const { cases } = JSON.parse(readFileSync("evals/matching-cases.json", "utf8")) as { cases: Case[] };
  const db = getDb();
  const ai = getAi();
  const needRows = await db.select({ id: needs.id, title: needs.title }).from(needs);
  const needTitle = new Map(needRows.map((n) => [n.id, n.title]));
  if (!needRows.length) throw new Error("No Customer Needs found. Run `make seed` first.");
  const { matchThreshold } = await getSettings();

  console.log(`Matching eval · provider: ${ai.llm.provider} · ${cases.length} cases · ${needRows.length} seeded Needs · threshold ${matchThreshold}\n`);
  const rows: { c: Case; got: string; need: string | null; confidence: number; retrieved: boolean; correct: boolean }[] = [];
  for (const c of cases) {
    const r = await matchRequest({ title: c.title, why: c.why }, { db, ai, timeoutMs: 30_000 });
    const need = r.needId ? needTitle.get(r.needId) ?? null : null;
    const retrieved = c.expectedNeed ? r.candidates.some((cand) => cand.title === c.expectedNeed) : true;
    const correct = r.relation === c.expected && (c.expected === "new" || need === c.expectedNeed);
    rows.push({ c, got: r.relation, need, confidence: r.confidence, retrieved, correct });
    console.log(`${correct ? "✓" : "✗"} ${c.id.padEnd(6)} expected ${c.expected.padEnd(7)} got ${r.relation.padEnd(7)} conf ${r.confidence.toFixed(2)}${retrieved ? "" : "  (expected Need not retrieved)"}`);
  }

  const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "—");
  const ok = rows.filter((r) => r.correct).length;
  console.log(`\nAccuracy: ${ok}/${rows.length} (${pct(ok, rows.length)})`);
  for (const label of ["same", "related", "new"] as const) {
    const of = rows.filter((r) => r.c.expected === label);
    console.log(`  ${label.padEnd(8)} ${of.filter((r) => r.correct).length}/${of.length} (${pct(of.filter((r) => r.correct).length, of.length)})`);
  }
  const withNeed = rows.filter((r) => r.c.expectedNeed);
  console.log(`Retrieval: expected Need in top-5 candidates for ${withNeed.filter((r) => r.retrieved).length}/${withNeed.length} (${pct(withNeed.filter((r) => r.retrieved).length, withNeed.length)})`);
  const avg = (xs: number[]) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : "—");
  console.log(`Mean confidence: correct ${avg(rows.filter((r) => r.correct).map((r) => r.confidence))} · incorrect ${avg(rows.filter((r) => !r.correct).map((r) => r.confidence))}`);
  const suggested = rows.filter((r) => (r.got === "same" || r.got === "related") && r.confidence >= matchThreshold).length;
  console.log(`Shown to customers as a match (≥ threshold): ${suggested}; the rest go to PM Triage.`);

  const wrong = rows.filter((r) => !r.correct);
  if (wrong.length) {
    console.log("\nIncorrect cases:");
    for (const r of wrong) console.log(`  ${r.c.id} (${r.c.kind}) "${r.c.title}": expected ${r.c.expected}${r.c.expectedNeed ? ` → ${r.c.expectedNeed}` : ""}; got ${r.got}${r.need ? ` → ${r.need}` : ""} (conf ${r.confidence.toFixed(2)})`);
  }
  await closeDb();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
