import { and, desc, eq } from "drizzle-orm";
import { getAi } from "@/ai";
import { getDb } from "@/db/client";
import { accounts, needs, projects, ticketEvents, tickets, ticketValidations, users } from "@/db/schema";
import { attachmentsForValidations, linkValidationAttachments, ownedAttachments, toView, type AttachmentView } from "./attachments";
import { ReworkUnderstanding, UNDERSTAND_REWORK, UNDERSTAND_REWORK_INSTRUCTIONS } from "./ai-tasks";
import { canViewAccountEvidence, type Actor } from "./permissions";
import { canCollaborate, customerTicket, recordStatusChange } from "./tracking";
import { projectWorkflow } from "./workflow";

// Customer validation after release: "Looks good", or "Something isn't right" -> an
// AI-understood rework request that the PM or a staffed engineer reviews. Customers never
// change ticket status themselves; only the team decides whether to reopen.

export type ReworkContext = ReworkUnderstanding;

/** The ticket must be one the customer tracks, and Released. */
async function releasedTicket(actor: Actor, ticketId: string) {
  const view = await customerTicket(actor, ticketId);
  if (!view) throw new Error("Ticket not found");
  if (view.ticket.publicStatus !== "released") throw new Error("You can review this once it's released");
  return view;
}

export async function confirmLooksGood(actor: Actor, ticketId: string) {
  const { validations } = await releasedTicket(actor, ticketId);
  if (validations.some((v) => v.verdict === "looks_good")) return;
  const db = getDb();
  await db.insert(ticketValidations).values({ ticketId, userId: actor.id, verdict: "looks_good" });
  await db.insert(ticketEvents).values({ ticketId, kind: "validation", visibility: "customer", authorId: actor.id, body: "Confirmed it looks good." });
}

/** AI reads the description and files together; a correction from the customer refines it. */
export async function understandRework(actor: Actor, ticketId: string, input: { description: string; attachmentIds: string[]; correction?: string }): Promise<{ understanding: ReworkContext; attachments: AttachmentView[] }> {
  const { ticket } = await releasedTicket(actor, ticketId);
  const files = await ownedAttachments(actor, input.attachmentIds, { unlinkedOnly: true });
  if (!input.description.trim() && !files.length) throw new Error("Tell us what isn't right, or attach a screenshot.");
  const views = files.map(toView);
  const understanding = await getAi().llm.generateStructured({
    name: UNDERSTAND_REWORK, instructions: UNDERSTAND_REWORK_INSTRUCTIONS, schema: ReworkUnderstanding,
    input: {
      feature: ticket.title, need: ticket.needTitle, description: input.description.trim(), correction: input.correction?.trim() ?? "",
      attachments: files.map((f, i) => ({ filename: f.filename, kind: f.kind, summary: views[i].summary ?? "", excerpt: (f.extractedText ?? "").slice(0, 3000) })),
    },
  });
  return { understanding, attachments: views };
}

export async function submitRework(actor: Actor, ticketId: string, input: { description: string; context: ReworkContext; attachmentIds: string[] }) {
  const { validations } = await releasedTicket(actor, ticketId);
  if (validations.some((v) => v.verdict === "rework" && v.state === "open")) throw new Error("You already reported a problem; the team is reviewing it.");
  if (!input.description.trim() && !input.context.summary.trim()) throw new Error("Tell us what isn't right.");
  const db = getDb();
  const [row] = await db.insert(ticketValidations).values({
    ticketId, userId: actor.id, verdict: "rework", state: "open", description: input.description.trim(), aiContext: input.context,
  }).returning();
  await linkValidationAttachments(actor, input.attachmentIds, row.id);
  await db.insert(ticketEvents).values({
    ticketId, kind: "validation", visibility: "customer", authorId: actor.id,
    body: `Reported something isn't right: ${input.context.summary || input.description.trim()}`,
  });
  return row.id;
}

export interface ReworkView {
  id: string;
  ticketId: string;
  ticketKey: string;
  ticketTitle: string;
  customer: string;
  accountName: string;
  description: string | null;
  context: ReworkContext | null;
  state: "open" | "reopened" | "declined";
  resolutionNote: string | null;
  createdAt: Date;
  attachments: AttachmentView[];
}

/** Rework requests for the team. Engineers only see those on clients they're staffed on. */
export async function reworkRequests(actor: Actor, opts: { ticketId?: string; openOnly?: boolean } = {}): Promise<ReworkView[]> {
  if (actor.role !== "pm" && actor.role !== "engineer") return [];
  const conditions = [eq(ticketValidations.verdict, "rework")];
  if (opts.ticketId) conditions.push(eq(ticketValidations.ticketId, opts.ticketId));
  if (opts.openOnly) conditions.push(eq(ticketValidations.state, "open"));
  const rows = await getDb()
    .select({
      id: ticketValidations.id, ticketId: tickets.id, ticketKey: tickets.key, ticketTitle: tickets.title, customer: users.name,
      accountId: projects.accountId, accountName: accounts.name, description: ticketValidations.description, context: ticketValidations.aiContext,
      state: ticketValidations.state, resolutionNote: ticketValidations.resolutionNote, createdAt: ticketValidations.createdAt,
    })
    .from(ticketValidations)
    .innerJoin(tickets, eq(tickets.id, ticketValidations.ticketId))
    .innerJoin(projects, eq(projects.id, tickets.projectId))
    .innerJoin(accounts, eq(accounts.id, projects.accountId))
    .innerJoin(users, eq(users.id, ticketValidations.userId))
    .where(and(...conditions)).orderBy(desc(ticketValidations.createdAt));
  const visible = rows.filter((r) => canViewAccountEvidence(actor, r.accountId));
  const files = await attachmentsForValidations(visible.map((r) => r.id));
  return visible.map((r) => ({ ...r, state: r.state!, context: (r.context as ReworkContext | null) ?? null, attachments: files.get(r.id) ?? [] }));
}

/**
 * The team's decision. Reopen moves the ticket back to the project's first In-progress
 * status (customers see "In Development" with the note); decline explains why to the customer.
 */
export async function reviewRework(actor: Actor, validationId: string, decision: "reopen" | "decline", note: string) {
  const db = getDb();
  const [v] = await db.select().from(ticketValidations).where(eq(ticketValidations.id, validationId));
  if (!v || v.verdict !== "rework" || !(await canCollaborate(actor, v.ticketId))) throw new Error("Rework request not found");
  if (v.state !== "open") throw new Error("This rework request was already reviewed");
  const text = note.trim();
  if (decision === "decline" && !text) throw new Error("Tell the customer why it isn't being reopened");
  if (text.length > 2000) throw new Error("Keep the note under 2000 characters");

  if (decision === "reopen") {
    const [ticket] = await db.select({ projectId: tickets.projectId, statusId: tickets.statusId, needId: tickets.needId }).from(tickets).where(eq(tickets.id, v.ticketId));
    const workflow = await projectWorkflow(ticket.projectId);
    const from = workflow.find((s) => s.id === ticket.statusId)!;
    // The first In-progress status customers see as "In Development".
    const to = workflow.find((s) => s.stage === "in_progress" && s.publicStatus !== "ready_for_review") ?? workflow.find((s) => s.stage === "in_progress");
    if (!to) throw new Error("This project has no In-progress status to reopen into");
    await db.update(tickets).set({ statusId: to.id }).where(eq(tickets.id, v.ticketId));
    await recordStatusChange(db, { ticketId: v.ticketId, actorId: actor.id, from, to, note: text || "We're reworking this based on your feedback." });
    // The Need is no longer fully released while one of its tickets is being reworked.
    await db.update(needs).set({ status: "in_development" }).where(and(eq(needs.id, ticket.needId), eq(needs.status, "released")));
  } else {
    await db.insert(ticketEvents).values({ ticketId: v.ticketId, kind: "validation", visibility: "customer", authorId: actor.id, body: `We looked into your report: ${text}` });
  }
  await db.update(ticketValidations).set({
    state: decision === "reopen" ? "reopened" : "declined", resolutionNote: text || null, resolvedBy: actor.id,
  }).where(eq(ticketValidations.id, validationId));
}
