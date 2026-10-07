import { cosineDistance, desc, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { registerMockHandler } from "@/ai/mock";
import type { AiProviders } from "@/ai/types";
import type { getDb } from "@/db/client";
import { needs } from "@/db/schema";

// Synchronous matching on submit:
// Feature Request -> embedding -> pgvector top-5 Customer Needs -> structured classification.

export const MatchClassification = z.object({
  relation: z.enum(["same", "related", "new"]),
  needId: z.string().nullable(),
  confidence: z.number(),
  reason: z.string(),
});
export type MatchClassification = z.infer<typeof MatchClassification>;

export interface Candidate {
  needId: string;
  title: string;
  problemStatement: string;
  similarity: number;
}

export type MatchResult =
  | (MatchClassification & { candidates: Candidate[]; triage: false })
  | { relation: "triage"; needId: null; confidence: 0; reason: string; candidates: Candidate[]; triage: true };

export const CLASSIFY_TASK = "classify_match";

const INSTRUCTIONS = `You match a customer's feature request to existing Customer Needs.
A Customer Need is the underlying product problem, not a feature title.
Given the request (title + why) and up to 5 candidate Needs with similarity scores:
- "same": the request describes the same underlying problem as one candidate.
- "related": it overlaps with a candidate but adds a distinct job or constraint.
- "new": no candidate describes this problem.
Return needId of the chosen candidate (null for "new"), a confidence from 0 to 1,
and a one-sentence reason a customer could read ("Why we think it matches").`;

// Deterministic stand-in used by the mock provider (no API key).
export const SAME_THRESHOLD = 0.5;
export const RELATED_THRESHOLD = 0.3;
registerMockHandler(CLASSIFY_TASK, (input) => {
  const { candidates } = input as { candidates: Candidate[] };
  const best = candidates[0];
  if (!best || best.similarity < RELATED_THRESHOLD) {
    return { relation: "new", needId: null, confidence: 0.6, reason: "No existing Customer Need describes this problem closely." };
  }
  const same = best.similarity >= SAME_THRESHOLD;
  return {
    relation: same ? "same" : "related",
    needId: best.needId,
    confidence: Math.round(Math.min(0.99, 0.5 + best.similarity / 2) * 100) / 100,
    reason: `${same ? "Describes the same problem as" : "Overlaps with"} "${best.title}".`,
  };
});

export interface MatchInput {
  title: string;
  why?: string;
}

type Db = ReturnType<typeof getDb>;

export async function findCandidates(db: Db, embedding: number[], limit = 5): Promise<Candidate[]> {
  const similarity = sql<number>`1 - (${cosineDistance(needs.embedding, embedding)})`;
  const rows = await db
    .select({ needId: needs.id, title: needs.title, problemStatement: needs.problemStatement, similarity })
    .from(needs)
    .where(isNotNull(needs.embedding))
    .orderBy(desc(similarity))
    .limit(limit);
  return rows.map((r) => ({ ...r, similarity: Number(r.similarity) }));
}

// Rejects as soon as the signal aborts, even if the provider ignores the signal.
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(new Error("aborted"));
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    promise.then(resolve, reject);
  });
}

export async function matchRequest(
  input: MatchInput,
  deps: { db: Db; ai: AiProviders; timeoutMs: number },
): Promise<MatchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
  let candidates: Candidate[] = [];
  try {
    const text = [input.title, input.why].filter(Boolean).join("\n");
    const { signal } = controller;
    const [embedding] = await untilAborted(deps.ai.embeddings.embed([text], { signal }), signal);
    candidates = await untilAborted(findCandidates(deps.db, embedding), signal);
    const result = await untilAborted(deps.ai.llm.generateStructured(
      {
        name: CLASSIFY_TASK,
        instructions: INSTRUCTIONS,
        input: { request: input, candidates: candidates.map((c) => ({ ...c, similarity: Math.round(c.similarity * 1000) / 1000 })) },
        schema: MatchClassification,
      },
      { signal },
    ), signal);
    return { ...sanitize(result, candidates), candidates, triage: false };
  } catch (error) {
    // Never block the submitter: save the request and let the PM triage it.
    const reason = controller.signal.aborted ? `AI matching timed out after ${deps.timeoutMs}ms` : `AI matching failed: ${(error as Error).message}`;
    return { relation: "triage", needId: null, confidence: 0, reason, candidates, triage: true };
  } finally {
    clearTimeout(timer);
  }
}

// The model may only pick a Need we actually offered it.
function sanitize(result: MatchClassification, candidates: Candidate[]): MatchClassification {
  const confidence = Math.max(0, Math.min(1, result.confidence));
  if (result.relation === "new") return { ...result, needId: null, confidence };
  if (!candidates.some((c) => c.needId === result.needId)) {
    return { relation: "new", needId: null, confidence: 0, reason: "Suggested Need was not among the candidates; treated as new." };
  }
  return { ...result, confidence };
}
