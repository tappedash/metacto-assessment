import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MockEmbeddingProvider, MockLanguageModel } from "@/ai/mock";
import { closeDb, getDb } from "@/db/client";
import { seed } from "@/db/seed";
import { matchRequest } from "@/domain/matching";

// Requires `npm run setup` (Postgres + migrations + seed). Uses the mock AI provider.
const ai = { llm: new MockLanguageModel(), embeddings: new MockEmbeddingProvider() };

beforeAll(() => seed({ quiet: true })); // fresh demo data for this file
afterAll(closeDb);

describe("synchronous matching against seeded Postgres + pgvector", () => {
  it("matches 'Export dashboard to Excel' to the export Customer Need", async () => {
    const result = await matchRequest(
      { title: "Export dashboard to Excel", why: "Finance reconciles shipping costs in spreadsheets every Monday." },
      { db: getDb(), ai, timeoutMs: 3000 },
    );
    expect(result.triage).toBe(false);
    expect(["same", "related"]).toContain(result.relation);
    expect(result.candidates[0].title).toBe("Use product data outside the platform");
    expect(result.needId).toBe(result.candidates[0].needId);
  });

  it("matches a different wording of the same problem", async () => {
    const result = await matchRequest({ title: "Google Sheets reporting" }, { db: getDb(), ai, timeoutMs: 3000 });
    expect(result.candidates[0].title).toBe("Use product data outside the platform");
  });

  it("falls back to Triage instead of failing when AI times out", async () => {
    const slow = { ...ai, embeddings: { ...ai.embeddings, provider: "slow", model: "slow", embed: () => new Promise<number[][]>(() => {}) } };
    const result = await matchRequest({ title: "Anything" }, { db: getDb(), ai: slow, timeoutMs: 50 });
    expect(result).toMatchObject({ relation: "triage", triage: true });
  });
});
