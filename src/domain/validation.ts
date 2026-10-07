import { and, desc, eq } from "drizzle-orm";
import { getAi } from "@/ai";
import { getDb } from "@/db/client";
import { accounts, needs, projects, ticketEvents, tickets, ticketValidations, users } from "@/db/schema";
import { attachmentsForValidations, linkValidationAttachments, ownedAttachments, toView, type AttachmentView } from "./attachments";
import { ReworkUnderstanding, UNDERSTAND_REWORK, UNDERSTAND_REWORK_INSTRUCTIONS } from "./ai-tasks";
import { canViewAccountEvidence, type Actor } from "./permissions";
import { canCollaborate, customerTicket, recordStatusChange } from "./tracking";
import { nextTicketKey } from "./delivery";
import { hrefs, notify, ticketPeople } from "./notifications";
import { getSettings } from "./settings";
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
  await db.insert(ticketEvents).values({ ticketId, kind: "validation", visibility: "customer", authorId: actor.id, body: "Confirmed it looks good.", publishedAt: new Date() });
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
    body: `Reported something isn't right: ${input.context.summary || input.description.trim()}`, publishedAt: new Date(),
  });
  const people = await ticketPeople(ticketId);
  const [customer] = await db.select({ name: users.name, account: accounts.name }).from(users).innerJoin(accounts, eq(accounts.id, users.accountId)).where(eq(users.id, actor.id));
  await notify({
    event: "rework.submitted", entity: { type: "rework", id: row.id }, actorId: actor.id, recipients: [people.assigneeId, ...people.pms],
    title: `${people.key}: customer reported something isn't right`,
    body: `${customer.name} (${customer.account}) reviewed ${people.key} ${people.title} after release:\n\n${input.context.summary || input.description.trim()}${input.context.expected ? `\nExpected: ${input.context.expected}` : ""}${input.context.actual ? `\nWhat happens: ${input.context.actual}` : ""}`,
    href: hrefs.ticket(ticketId),
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
  state: "open" | "reopened" | "follow_up" | "declined";
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

export type ReworkDecision = "reopen" | "follow_up" | "decline";

/**
 * The team's decision on a rework request:
 * - reopen: the ticket goes back to the project's first In-progress status (customers see
 *   "In Development" with the note);
 * - follow_up (PM only): a new Planned ticket on the same Need, project and assignee;
 * - decline: the note explains to the customer why nothing changes.
 */
export async function reviewRework(actor: Actor, validationId: string, decision: ReworkDecision, note: string) {
  const db = getDb();
  const [v] = await db.select().from(ticketValidations).where(eq(ticketValidations.id, validationId));
  if (!v || v.verdict !== "rework" || !(await canCollaborate(actor, v.ticketId))) throw new Error("Rework request not found");
  if (v.state !== "open") throw new Error("This rework request was already reviewed");
  if (decision === "follow_up" && actor.role !== "pm") throw new Error("Only the Product Manager creates follow-up tickets");
  const text = note.trim();
  if (decision === "decline" && !text) throw new Error("Tell the customer why it isn't being reopened");
  if (text.length > 2000) throw new Error("Keep the note under 2000 characters");
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, v.ticketId));
  const workflow = await projectWorkflow(ticket.projectId);
  let followUpTicketId: string | null = null;

  if (decision === "reopen") {
    const from = workflow.find((s) => s.id === ticket.statusId)!;
    // The first In-progress status customers see as "In Development".
    const to = workflow.find((s) => s.stage === "in_progress" && s.publicStatus !== "ready_for_review") ?? workflow.find((s) => s.stage === "in_progress");
    if (!to) throw new Error("This project has no In-progress status to reopen into");
    await db.update(tickets).set({ statusId: to.id }).where(eq(tickets.id, v.ticketId));
    await recordStatusChange(db, { ticketId: v.ticketId, actorId: actor.id, from, to, note: text || "We're reworking this based on your feedback." });
    // The Need is no longer fully released while one of its tickets is being reworked.
    await db.update(needs).set({ status: "in_development" }).where(and(eq(needs.id, ticket.needId), eq(needs.status, "released")));
  } else if (decision === "follow_up") {
    const planned = workflow.find((s) => s.stage === "planned");
    if (!planned) throw new Error("This project has no Planned status");
    const ctx = v.aiContext as ReworkContext | null;
    const [row] = await db.insert(tickets).values({
      key: await nextTicketKey(), projectId: ticket.projectId, needId: ticket.needId, statusId: planned.id,
      title: `Follow-up: ${ticket.title}`, priority: ticket.priority, assigneeId: ticket.assigneeId,
      notes: [ctx?.summary, ctx?.expected && `Expected: ${ctx.expected}`, ctx?.actual && `What happens: ${ctx.actual}`, ctx?.impact && `Impact: ${ctx.impact}`].filter(Boolean).join("\n") || v.description,
    }).returning({ id: tickets.id });
    followUpTicketId = row.id;
    await db.insert(ticketEvents).values({ ticketId: row.id, kind: "status", authorId: actor.id, toStatus: planned.name, publicStatus: "planned", visibility: "customer", publishedAt: new Date(), body: "Follow-up work from your feedback." });
    await db.insert(ticketEvents).values({ ticketId: v.ticketId, kind: "validation", visibility: "customer", publishedAt: new Date(), authorId: actor.id,
      body: `We're following up on your report with new planned work.${text ? ` ${text}` : ""}` });
  } else {
    await db.insert(ticketEvents).values({ ticketId: v.ticketId, kind: "validation", visibility: "customer", publishedAt: new Date(), authorId: actor.id, body: `We looked into your report: ${text}` });
  }
  const state = decision === "reopen" ? "reopened" : decision === "follow_up" ? "follow_up" : "declined";
  await db.update(ticketValidations).set({ state, resolutionNote: text || null, resolvedBy: actor.id, followUpTicketId }).where(eq(ticketValidations.id, validationId));

  // The customer hears the decision (if the Admin enabled it); the assignee always does.
  const settings = await getSettings();
  const outcome = { reopen: "reopened for rework", follow_up: "accepted as follow-up work", decline: "reviewed; it won't be reopened" }[decision];
  await notify({
    event: "rework.resolved", entity: { type: "rework", id: validationId }, actorId: actor.id,
    recipients: [settings.customerNotify.rework_decision ? v.userId : null, ticket.assigneeId],
    title: `${ticket.title}: your report was ${outcome}`, body: text || `The team ${outcome.replace("reviewed; ", "")}.`, href: hrefs.ticket(followUpTicketId ?? v.ticketId),
  });
  if (followUpTicketId && ticket.assigneeId) {
    await notify({ event: "ticket.created", entity: { type: "ticket", id: followUpTicketId }, actorId: actor.id, recipients: [ticket.assigneeId],
      title: `Follow-up ticket assigned: ${ticket.title}`, body: "A customer's rework request was accepted as a follow-up ticket assigned to you.", href: hrefs.ticket(followUpTicketId) });
  }
}
