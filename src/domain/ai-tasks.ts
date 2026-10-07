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

// ---------- attachments: "AI reviewed your attachment" ----------
export const SUMMARIZE_ATTACHMENT = "summarize_attachment";
export const AttachmentSummary = z.object({ summary: z.string(), terms: z.array(z.string()) });
export type AttachmentSummary = z.infer<typeof AttachmentSummary>;
export const SUMMARIZE_ATTACHMENT_INSTRUCTIONS = `A customer attached a file to their product feedback. In ONE sentence starting with
"This document appears to describe", "This spreadsheet appears to show" or "This screenshot appears to show",
say what it shows about how they work. Then list up to 6 domain terms from it (e.g. report names, tools).
Plain language. Never mention AI, models, OCR or how the file was read.`;

const KIND_NOUN: Record<string, string> = { pdf: "document", document: "document", spreadsheet: "spreadsheet", image: "screenshot", text: "note" };

function firstSentence(text: string): string {
  const s = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/)[0] ?? "";
  return s.length > 180 ? s.slice(0, 177) + "…" : s;
}

/** Capitalised words and known product terms that recur in a text, for "terms" chips. */
export function keyTerms(text: string, limit = 6): string[] {
  const counts = new Map<string, number>();
  for (const m of text.matchAll(/\b([A-Z][A-Za-z]{2,}|CSV|ERP|KPI|SLA|BI|PDF)\b/g)) {
    const w = m[1];
    if (/^(The|This|That|Our|We|They|Today|Every|Each|When|What|With|From|And|For|Yes|No|True|False)$/.test(w)) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([w]) => w);
}

registerMockHandler(SUMMARIZE_ATTACHMENT, (input) => {
  const { filename, kind, text } = input as { filename: string; kind: string; text: string | null };
  const noun = KIND_NOUN[kind] ?? "file";
  if (!text) {
    return { summary: `This ${noun} (${filename}) was attached. Describe what it shows so we can take it into account.`, terms: [] };
  }
  if (kind === "spreadsheet") {
    const header = text.split("\n").find((l) => l.includes(",") && !l.startsWith("#")) ?? "";
    const cols = header.split(",").map((c) => c.trim()).filter(Boolean).slice(0, 5);
    const rows = text.split("\n").filter((l) => l.includes(",")).length - 1;
    return { summary: `This spreadsheet appears to show ${Math.max(rows, 0)} rows tracking ${cols.join(", ") || "data"}.`, terms: keyTerms(text) };
  }
  return { summary: `This ${noun} appears to describe: ${firstSentence(text)}`, terms: keyTerms(text) };
});

// ---------- understanding: description + details + files -> the customer's problem ----------
export const UNDERSTAND_FEEDBACK = "understand_feedback";
export const Understanding = z.object({
  summary: z.string(),
  title: z.string(),
  goal: z.string(),
  workaround: z.string(),
  impact: z.string(),
  terms: z.array(z.string()),
  question: z.string(),
});
export type Understanding = z.infer<typeof Understanding>;
export const UNDERSTAND_FEEDBACK_INSTRUCTIONS = `A customer is sharing product feedback: a short description, optional details, and
optional attachments (with what each attachment shows). Use ALL of it together.
- summary: one sentence starting "From your <sources>, it looks like ..." describing the underlying problem,
  ending with "Is that the main problem?".
- title: a short request title in the customer's words.
- goal: what they are trying to accomplish. workaround: what they do today. impact: the pain (time, errors, risk).
  Use "" when the material doesn't say.
- terms: up to 6 domain terms.
- question: if goal or workaround is unclear, ONE friendly question to ask; otherwise "".
Never invent facts. Never mention AI, models, OCR, embeddings or matching.`;

function sentences(text: string): string[] {
  // Documents often use line breaks instead of full stops; treat both as boundaries.
  return text.split(/\n+|(?<=[.!?])\s+/).map((s) => s.replace(/\s+/g, " ").trim()).filter((s) => s.length > 8);
}
/** First sentence matching the strongest pattern, falling back to weaker ones. */
const pick = (all: string[], ...patterns: RegExp[]) => {
  for (const re of patterns) {
    const hit = all.find((s) => re.test(s));
    if (hit) return hit;
  }
  return "";
};

registerMockHandler(UNDERSTAND_FEEDBACK, (input) => {
  const { title, details, attachments } = input as {
    title: string; details: string; attachments: { filename: string; kind: string; summary: string; excerpt: string }[];
  };
  const all = sentences([details, ...attachments.map((a) => a.excerpt)].join(" "));
  const goal = pick(all, /\b(so that|so we can|in order to|trying to|need to|want to)\b/i, /\b(reconcile|share|report)\b/i);
  const workaround = pick(all, /\b(today|currently|by hand|manually|manual)\b/i, /\b(copy|copies|spreadsheet|export)\b/i);
  const impact = pick(all, /\b(hours?|minutes|errors?|mistakes?|delays?|risk|blocks?)\b/i, /\b(slow|every (day|week|monday))\b/i);
  const sources = [details.trim() || title.trim() ? "description" : "", ...attachments.map((a) => KIND_NOUN[a.kind] ?? "file")].filter(Boolean);
  const from = sources.length > 1 ? `${sources.slice(0, -1).join(", ")} and ${sources.at(-1)}` : sources[0] ?? "feedback";
  const core = (goal || workaround || title || "you need a change to how this works").replace(/[.!?]$/, "");
  const lower = core.charAt(0).toLowerCase() + core.slice(1);
  return {
    summary: `From your ${from}, it looks like ${lower}. Is that the main problem?`,
    title: title.trim() || (attachments[0]?.filename.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ") ?? "Feedback"),
    goal, workaround, impact,
    terms: keyTerms([title, details, ...attachments.map((a) => a.excerpt)].join(" ")),
    question: goal || workaround ? "" : "What are you trying to get done, and how do you handle it today?",
  };
});
