import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { getAi } from "@/ai";
import { registerMockHandler } from "@/ai/mock";
import { getDb } from "@/db/client";
import { needs, requests, statusUpdates, supports } from "@/db/schema";
import { myAttachments, ownedAttachments, toView, type AttachmentView } from "./attachments";
import { NEED_STATUS } from "./labels";
import { findCandidates, RELATED_THRESHOLD } from "./matching";
import type { SessionActor } from "./session";

// "Ask Needs Hub": a client assistant grounded ONLY in what this customer may see —
// their requests, supported Needs, public Need fields, approved updates and their files.
// No other customers, contract values, scores, internal or engineering notes.

export const ASSISTANT = "client_assistant";

export const AssistantAnswer = z.object({
  answer: z.string(),
  links: z.array(z.object({ label: z.string(), href: z.string() })),
});
export type AssistantAnswer = z.infer<typeof AssistantAnswer>;

export const ASSISTANT_INSTRUCTIONS = `You are Needs Hub, a helpful product teammate for a customer.
Answer ONLY from the JSON context: the customer's requests, the Customer Needs listed, their public status,
public rationale, approved updates and the customer's own files. If the context doesn't contain the answer,
say so plainly, e.g. "I couldn't find an approved update about that yet."
Never invent dates, plans, commitments or decisions. Only mention dates that appear in approved updates.
Never mention other customers, scores, priorities or internal details (they are not in the context anyway).
Be concise and conversational (1-3 short sentences, no preamble like "Based on the information...").
Refer to Needs by their title in quotes. Use status labels as given (Under Review, Planned, In Development,
Released, Not Planned). Add up to 3 links, using ONLY hrefs present in the context, with short labels such as
"View Customer Need", "View my requests", "View latest update", "Open attachment", "Share this as feedback".
Never mention AI models, embeddings or search. Do not submit anything; when a file looks like new feedback,
offer the "Share this as feedback" link so the customer can confirm.`;

interface NeedCtx {
  id: string; title: string; problemStatement: string; status: string; statusLabel: string; supporters: number;
  publicRationale: string | null; latestUpdate: { subject: string; body: string; date: string } | null; href: string; similarity: number;
}
interface RequestCtx { title: string; why: string; submitted: string; state: "grouped" | "waiting_for_review"; needId: string | null; needTitle: string | null; statusLabel: string | null; href: string }
interface FileCtx { id: string; filename: string; summary: string | null; href: string }
interface AssistantContext {
  question: string;
  history: { role: "user" | "assistant"; text: string }[];
  page: { needId: string | null };
  myRequests: RequestCtx[];
  supporting: { needId: string; title: string; statusLabel: string; href: string }[];
  needs: NeedCtx[];
  files: FileCtx[];
  newAttachment: (FileCtx & { shareHref: string; suggestedNeedId: string | null }) | null;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Everything the assistant may know for this customer. Exported so tests can prove what's excluded. */
export async function buildContext(actor: SessionActor, input: AskInput): Promise<AssistantContext> {
  const db = getDb();
  const mine = await db
    .select({ title: requests.title, why: requests.why, createdAt: requests.createdAt, linkState: requests.linkState, needId: needs.id, needTitle: needs.title, needStatus: needs.status })
    .from(requests).leftJoin(needs, eq(needs.id, requests.needId))
    .where(eq(requests.submittedBy, actor.id)).orderBy(desc(requests.createdAt)).limit(20);
  const supported = await db.select({ needId: needs.id, title: needs.title, status: needs.status })
    .from(supports).innerJoin(needs, eq(needs.id, supports.needId)).where(eq(supports.userId, actor.id));

  // Needs related to the question (and to any file just shared), plus the customer's own.
  let newFile: AttachmentView | null = null;
  let fileText = "";
  if (input.attachmentId) {
    const [row] = await ownedAttachments(actor, [input.attachmentId]);
    if (row) { newFile = toView(row); fileText = `${newFile.summary ?? ""}\n${(row.extractedText ?? "").slice(0, 2000)}`; }
  }
  const { embeddings } = getAi();
  const [vector] = await embeddings.embed([[input.question, fileText].filter(Boolean).join("\n")]);
  const related = await findCandidates(db, vector, 4);
  const ids = new Set<string>([
    ...related.filter((c) => c.similarity >= RELATED_THRESHOLD).map((c) => c.needId),
    ...mine.filter((r) => r.linkState === "confirmed" && r.needId).map((r) => r.needId!),
    ...supported.map((s) => s.needId),
    ...(input.pageNeedId ? [input.pageNeedId] : []),
  ]);
  const needRows = ids.size ? await db.select().from(needs).where(inArray(needs.id, [...ids])) : [];
  const supportCounts = ids.size ? await db.select({ needId: supports.needId }).from(supports).where(inArray(supports.needId, [...ids])) : [];
  const updates = ids.size
    ? await db.select().from(statusUpdates).where(and(inArray(statusUpdates.needId, [...ids]), isNotNull(statusUpdates.sentAt))).orderBy(desc(statusUpdates.sentAt))
    : [];
  const similarity = new Map(related.map((c) => [c.needId, c.similarity]));
  const needCtx: NeedCtx[] = needRows.map((n) => {
    const u = updates.find((x) => x.needId === n.id);
    return {
      id: n.id, title: n.title, problemStatement: n.problemStatement, status: n.status, statusLabel: NEED_STATUS[n.status].label,
      supporters: supportCounts.filter((s) => s.needId === n.id).length, publicRationale: n.publicRationale,
      latestUpdate: u ? { subject: u.subject, body: u.body, date: day(u.sentAt!) } : null,
      href: `/client/needs/${n.id}`, similarity: Math.round((similarity.get(n.id) ?? 0) * 100) / 100,
    };
  }).sort((a, b) => b.similarity - a.similarity);

  const files = (await myAttachments(actor, 5)).map(toView).map((f) => ({ id: f.id, filename: f.filename, summary: f.summary, href: f.href }));
  const suggested = newFile ? related.find((c) => c.similarity >= RELATED_THRESHOLD)?.needId ?? null : null;
  return {
    question: input.question,
    history: input.history.slice(-6),
    page: { needId: input.pageNeedId ?? null },
    myRequests: mine.map((r) => ({
      title: r.title, why: r.why, submitted: day(r.createdAt),
      state: r.linkState === "confirmed" && r.needId ? "grouped" : "waiting_for_review",
      needId: r.linkState === "confirmed" ? r.needId : null, needTitle: r.linkState === "confirmed" ? r.needTitle : null,
      statusLabel: r.linkState === "confirmed" && r.needStatus ? NEED_STATUS[r.needStatus].label : null,
      href: r.linkState === "confirmed" && r.needId ? `/client/needs/${r.needId}` : "/client/activity",
    })),
    supporting: supported.map((s) => ({ needId: s.needId, title: s.title, statusLabel: NEED_STATUS[s.status].label, href: `/client/needs/${s.needId}` })),
    needs: needCtx,
    files,
    newAttachment: newFile ? { id: newFile.id, filename: newFile.filename, summary: newFile.summary, href: newFile.href, shareHref: `/client/share?attachment=${newFile.id}`, suggestedNeedId: suggested } : null,
  };
}

export interface AskInput {
  question: string;
  history: { role: "user" | "assistant"; text: string }[];
  pageNeedId?: string;
  attachmentId?: string;
}

export async function askAssistant(actor: SessionActor, input: AskInput): Promise<AssistantAnswer> {
  if (actor.role !== "client") throw new Error("The assistant is available to client users");
  const ctx = await buildContext(actor, input);
  const allowed = new Set<string>(["/client/activity", "/client/share", "/client/discover", ...ctx.needs.map((n) => n.href), ...ctx.files.map((f) => f.href)]);
  if (ctx.newAttachment) { allowed.add(ctx.newAttachment.href); allowed.add(ctx.newAttachment.shareHref); }
  try {
    const reply = await getAi().llm.generateStructured({ name: ASSISTANT, instructions: ASSISTANT_INSTRUCTIONS, input: ctx, schema: AssistantAnswer });
    const links = reply.links.filter((l) => allowed.has(l.href)).slice(0, 3); // the AI may only link to what the customer can see
    return { answer: reply.answer.trim() || "I couldn't find anything about that yet.", links };
  } catch {
    return { answer: "I couldn't look that up right now. Please try again in a moment.", links: [] };
  }
}

// ---------- deterministic assistant for keyless local runs ----------

const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)));
const STOP = new Set(["what", "the", "and", "for", "this", "that", "with", "about", "you", "your", "have", "has", "was", "why", "did", "does", "can", "are", "any", "already", "feedback", "request", "requests", "feature", "need", "needs", "happened", "planned", "latest", "update", "status", "marked", "not", "my", "mine"]);
const overlap = (a: Set<string>, b: Set<string>) => [...a].filter((w) => b.has(w) || b.has(w.replace(/s$/, ""))).length;
const firstSentence = (s: string) => (s.replace(/\s+/g, " ").match(/^.*?[.!?](\s|$)/)?.[0] ?? s).trim();
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

registerMockHandler(ASSISTANT, (raw) => {
  const c = raw as AssistantContext;
  const q = c.question.toLowerCase();
  const qWords = words(c.question);
  const link = (label: string, href: string) => ({ label, href });
  const needLink = (n: { href: string }) => link("View Customer Need", n.href);

  // A file was just shared: say what it is and offer the matching Need. Never submit.
  if (c.newAttachment) {
    const f = c.newAttachment;
    const need = c.needs.find((n) => n.id === f.suggestedNeedId);
    const about = f.summary ? `${f.summary} ` : "";
    return {
      answer: need
        ? `${about}This looks like feedback about "${need.title}", an existing Customer Need (${need.statusLabel}, ${plural(need.supporters, "supporter")}). Want to share it as feedback? Nothing is submitted until you confirm.`
        : `${about}I couldn't find an existing Customer Need for this yet. You can share it as new feedback; nothing is submitted until you confirm.`,
      links: [...(need ? [link("View matching Need", need.href)] : []), link("Share this as feedback", f.shareHref), link("Open attachment", f.href)],
    };
  }

  // Which Need is the question about? The customer's own request wording first, then the page, then similarity.
  const byRequest = c.myRequests
    .filter((r) => r.needId)
    .map((r) => ({ r, score: overlap(qWords, words(`${r.title} ${r.why}`)) }))
    .sort((a, b) => b.score - a.score)[0];
  const ownRequest = byRequest && byRequest.score > 0 ? byRequest.r : null;
  const target =
    (ownRequest && c.needs.find((n) => n.id === ownRequest.needId)) ||
    (c.page.needId && /\b(this|it|here)\b|latest update|not planned/.test(q) ? c.needs.find((n) => n.id === c.page.needId) : undefined) ||
    c.needs.find((n) => overlap(qWords, words(`${n.title} ${n.problemStatement}`)) > 0) ||
    (c.page.needId ? c.needs.find((n) => n.id === c.page.needId) : undefined);

  if (/\b(submitted|sent|my requests|have i (asked|shared|requested))\b/.test(q)) {
    if (!c.myRequests.length) return { answer: "You haven't submitted any requests yet.", links: [link("Share feedback", "/client/share")] };
    const list = c.myRequests.slice(0, 4).map((r) => r.needTitle ? `"${r.title}" (grouped under "${r.needTitle}", ${r.statusLabel})` : `"${r.title}" (waiting for product review)`);
    return { answer: `You've submitted ${plural(c.myRequests.length, "request")}: ${list.join("; ")}.`, links: [link("View my requests", "/client/activity")] };
  }

  if (/\b(supporting|i support|following|i follow)\b/.test(q)) {
    if (!c.supporting.length) return { answer: "You're not supporting any needs yet.", links: [link("Discover needs", "/client/discover")] };
    return {
      answer: `You're supporting ${plural(c.supporting.length, "need")}: ${c.supporting.map((s) => `"${s.title}" (${s.statusLabel})`).join(", ")}.`,
      links: c.supporting.slice(0, 3).map((s) => link(s.title, s.href)),
    };
  }

  if (/summar|what('s| is) (in )?(this|my) (file|document|attachment|upload)|uploaded/.test(q)) {
    const f = c.files.at(-1);
    if (!f) return { answer: "I don't see any files from you yet. Attach one here or in Share Feedback and I'll take a look.", links: [] };
    return { answer: f.summary ? `${f.filename}: ${f.summary}` : `I have ${f.filename}, but I couldn't read its contents.`, links: [link("Open attachment", f.href)] };
  }

  if (/not planned|why (was|is) (it|this)|rejected|declined/.test(q)) {
    if (!target) return { answer: "I couldn't tell which need you mean. Open it and ask again, or tell me its name.", links: [] };
    if (target.status !== "not_planned") return { answer: `"${target.title}" isn't marked Not Planned. It's currently ${target.statusLabel}.`, links: [needLink(target)] };
    return { answer: target.publicRationale ? `"${target.title}" is Not Planned for now. The reason given: ${target.publicRationale}` : `"${target.title}" is Not Planned, but no reason was published yet.`, links: [needLink(target)] };
  }

  if (/\b(update|updates|news|latest)\b/.test(q)) {
    const n = target ?? c.needs.find((x) => x.latestUpdate);
    if (!n || !n.latestUpdate) return { answer: `I couldn't find an approved update${n ? ` about "${n.title}"` : " about that"} yet.`, links: n ? [needLink(n)] : [] };
    return { answer: `Latest update on "${n.title}" (${n.latestUpdate.date}): ${n.latestUpdate.subject}. ${firstSentence(n.latestUpdate.body)}`, links: [link("View latest update", n.href)] };
  }

  if (/\b(already|existing|anyone|others|similar|do you have|is there)\b/.test(q)) {
    const n = c.needs.find((x) => x.similarity >= 0.3) ?? target;
    if (!n) return { answer: "I couldn't find existing feedback about that. You can share it as a new request.", links: [link("Share feedback", "/client/share")] };
    return { answer: `Yes, "${n.title}" covers that: ${n.problemStatement} It's ${n.statusLabel}, with ${plural(n.supporters, "supporter")}.`, links: [needLink(n)] };
  }

  if (target) {
    const when = /\bwhen\b|date|eta|deadline/.test(q) ? " I don't have a date for that; I only share dates from approved updates." : "";
    const why = target.status === "not_planned" && target.publicRationale ? ` Reason: ${target.publicRationale}` : "";
    const answer = ownRequest
      ? `Your "${ownRequest.title}" request was grouped under "${target.title}". It's currently ${target.statusLabel}.${why}${when}`
      : `"${target.title}" is currently ${target.statusLabel}.${why}${when}`;
    return { answer, links: [needLink(target), ...(target.latestUpdate ? [link("View latest update", target.href)] : []), ...(ownRequest ? [link("View my requests", "/client/activity")] : [])].slice(0, 3) };
  }

  return { answer: "I couldn't find anything about that in your requests or approved updates yet.", links: [link("View my requests", "/client/activity")] };
});
