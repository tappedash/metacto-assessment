import { z } from "zod";
import { registerMockHandler } from "@/ai/mock";

// Every AI task the workflow uses: a stable name, instructions, a zod schema for
// structured output, and a deterministic mock handler for keyless local runs.

// ---------- follow-up question when the "why" is missing ----------
export const FOLLOW_UP = "follow_up_question";
export const FollowUp = z.object({ needed: z.boolean(), question: z.string() });
export const FOLLOW_UP_INSTRUCTIONS = `A customer is submitting product feedback. Decide whether you need to ask ONE short
follow-up question to understand the underlying problem (what they are trying to accomplish
and what they do today). Ask only if the request describes a solution or feature without the goal.
Write the question in plain, friendly language. Never mention AI, embeddings or matching.`;
registerMockHandler(FOLLOW_UP, (input) => {
  const { title, why } = input as { title: string; why: string };
  const needed = (why ?? "").trim().length < 20;
  return {
    needed,
    question: needed ? `What will you do once "${title}" is possible, and how do you handle it today?` : "",
  };
});

// ---------- refine a Customer Need's problem statement with new evidence ----------
export const REFINE_NEED = "refine_need";
export const RefinedNeed = z.object({ problemStatement: z.string() });
export const REFINE_NEED_INSTRUCTIONS = `Rewrite the Customer Need's problem statement so it reflects all the evidence.
Format: "[Who] need to [job] because [reason]; today they [workaround]." One or two sentences.
Describe the underlying problem, never a specific feature. Keep it if it is already accurate.`;
registerMockHandler(REFINE_NEED, (input) => ({ problemStatement: (input as { current: string }).current }));

// ---------- draft a new Customer Need from a Feature Request ----------
export const DRAFT_NEED = "draft_need";
export const DraftNeed = z.object({ title: z.string(), problemStatement: z.string() });
export const DRAFT_NEED_INSTRUCTIONS = `Turn this Feature Request into a Customer Need: a short problem-oriented title
(not a feature name) and a problem statement in the format
"[Who] need to [job] because [reason]; today they [workaround]."`;
registerMockHandler(DRAFT_NEED, (input) => {
  const { title, why } = input as { title: string; why: string };
  return {
    title: title.replace(/\.$/, ""),
    problemStatement: why ? `Customers need ${title.toLowerCase().replace(/\.$/, "")} because ${why.replace(/\.$/, "").toLowerCase()}.` : `Customers need ${title.toLowerCase()}.`,
  };
});

// ---------- AI Brief: evidence-backed summary with citations ----------
export const AI_BRIEF = "ai_brief";
export const AiBrief = z.object({
  summary: z.string(),
  keyPoints: z.array(z.object({ text: z.string(), citations: z.array(z.string()) })),
});
export type AiBrief = z.infer<typeof AiBrief>;
export const AI_BRIEF_INSTRUCTIONS = `Summarise why customers need this, for a Product Manager.
Use only the evidence provided. Every key point must cite the request ids it is based on.
2-4 key points. Mention the common workaround if the evidence shows one.`;
registerMockHandler(AI_BRIEF, (input) => {
  const { evidence, signals } = input as {
    evidence: { id: string; account: string; title: string; why: string }[];
    signals: { requests: number; accounts: number; trendPct: number | null };
  };
  const trend = signals.trendPct === null ? "" : ` Demand ${signals.trendPct >= 0 ? "up" : "down"} ${Math.abs(signals.trendPct)}% vs the previous 30 days.`;
  return {
    summary: `${signals.requests} Feature Requests from ${signals.accounts} accounts describe this problem.${trend}`,
    keyPoints: evidence.slice(0, 3).map((e) => ({
      text: `${e.account}: ${e.why || e.title}`,
      citations: [e.id],
    })),
  };
});

// ---------- rubric prefill ----------
export const RUBRIC = "prefill_rubric";
export const RUBRIC_KEYS = ["reach", "revenue_impact", "strategic_fit", "severity"] as const;
export const Rubric = z.object({
  criteria: z.array(z.object({
    key: z.enum(RUBRIC_KEYS),
    score: z.number().int(),
    reason: z.string(),
    citations: z.array(z.string()),
  })),
  suggestedPriority: z.enum(["P0", "P1", "P2", "P3"]),
  reason: z.string(),
});
export type Rubric = z.infer<typeof Rubric>;
export const RUBRIC_INSTRUCTIONS = `Score this Customer Need from 1 (low) to 5 (high) on: reach, revenue_impact,
strategic_fit (against the strategic goals given), severity. Use the signals and evidence only;
cite request ids for each score. Suggest a priority P0 (highest) to P3 with a one-sentence reason.
The Product Manager makes the final decision.`;
registerMockHandler(RUBRIC, (input) => {
  const { evidence, signals, goals } = input as {
    evidence: { id: string; why: string }[];
    signals: { accounts: number; supporters: number; enterpriseAccounts: number; contractValue: number };
    goals: { code: string; text: string }[];
  };
  const clamp = (n: number) => Math.max(1, Math.min(5, Math.round(n)));
  const cites = evidence.slice(0, 2).map((e) => e.id);
  const reach = clamp(1 + signals.accounts / 2 + signals.supporters / 6);
  const revenue = clamp(1 + signals.enterpriseAccounts + signals.contractValue / 1_000_000);
  const strategic = clamp(1 + signals.enterpriseAccounts * 1.5);
  const severe = evidence.some((e) => /every|hours|by hand|manual|block|security|customers first/i.test(e.why));
  const severity = severe ? 4 : 2;
  const total = reach + revenue + strategic + severity;
  const suggestedPriority = total >= 15 ? "P0" : total >= 12 ? "P1" : total >= 9 ? "P2" : "P3";
  return {
    criteria: [
      { key: "reach", score: reach, reason: `${signals.accounts} accounts, ${signals.supporters} supporters.`, citations: cites },
      { key: "revenue_impact", score: revenue, reason: `${signals.enterpriseAccounts} enterprise accounts affected.`, citations: cites },
      { key: "strategic_fit", score: strategic, reason: goals[0] ? `Weighed against ${goals.map((g) => g.code).join(", ")}.` : "No strategic goals set.", citations: [] },
      { key: "severity", score: severity, reason: severe ? "Evidence describes a blocked workflow or manual workaround." : "Evidence describes an inconvenience.", citations: cites },
    ],
    suggestedPriority,
    reason: `Combined score ${total}/20.`,
  };
});

// ---------- stakeholder update draft ----------
export const DRAFT_UPDATE = "draft_update";
export const DraftUpdate = z.object({ subject: z.string(), body: z.string() });
export const DRAFT_UPDATE_INSTRUCTIONS = `Draft a short, honest update for customers who requested or support this Customer Need.
Say what changed, why (use the rationale), and what happens next. No internal details: no scores,
contract values, client names or engineering notes. Under 120 words. Plain text.`;
registerMockHandler(DRAFT_UPDATE, (input) => {
  const { need, statusLabel, rationale } = input as { need: { title: string }; statusLabel: string; rationale: string };
  return {
    subject: `${statusLabel}: ${need.title}`,
    body: `Thanks for telling us about "${need.title}". It is now ${statusLabel.toLowerCase()}.\n\n${rationale}\n\nWe'll keep you posted as it progresses.`,
  };
});
