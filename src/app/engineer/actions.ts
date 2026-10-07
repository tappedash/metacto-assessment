"use server";

import { revalidatePath } from "next/cache";
import { moveTicket, saveTicketNotes } from "@/domain/delivery";
import { addComment, requestPmInput } from "@/domain/tracking";
import { requireActor } from "@/domain/session";
import { reviewRework } from "@/domain/validation";
import { str, withFlash } from "@/lib/flash";

export async function moveMyTicketAction(ticketId: string, back: string, form: FormData) {
  const actor = await requireActor(["engineer"]);
  await withFlash(back, async () => {
    const { needStatusChanged, status } = await moveTicket(actor, ticketId, str(form, "to"));
    revalidatePath("/", "layout");
    return needStatusChanged ? `Moved to ${status}. AI drafted a customer update for the PM to approve.` : `Moved to ${status}.`;
  });
}

export async function addCommentAction(ticketId: string, form: FormData) {
  const actor = await requireActor(["engineer"]);
  await withFlash(`/engineer/tickets/${ticketId}`, async () => {
    const visibility = str(form, "visibility") === "customer" ? "customer" : "internal";
    await addComment(actor, ticketId, str(form, "body"), visibility);
    revalidatePath("/", "layout");
    return visibility === "customer" ? "Update sent to the PM for approval before customers see it." : "Internal update posted.";
  });
}

export async function requestPmInputAction(ticketId: string, form: FormData) {
  const actor = await requireActor(["engineer"]);
  await withFlash(`/engineer/tickets/${ticketId}`, async () => {
    await requestPmInput(actor, ticketId, str(form, "question"));
    revalidatePath("/", "layout");
    return "Question sent to the PM.";
  });
}

export async function reviewReworkAction(ticketId: string, validationId: string, form: FormData) {
  const actor = await requireActor(["engineer"]);
  await withFlash(`/engineer/tickets/${ticketId}`, async () => {
    const choice = str(form, "decision");
    const decision = choice === "reopen" || choice === "follow_up" ? choice : "decline";
    await reviewRework(actor, validationId, decision, str(form, "note"));
    revalidatePath("/", "layout");
    return decision === "reopen" ? "Ticket reopened. The customer sees it back In Development."
      : decision === "follow_up" ? "Follow-up ticket created as Planned. The customer can track it." : "Decision sent to the customer.";
  });
}

export async function saveNotesAction(ticketId: string, form: FormData) {
  const actor = await requireActor(["engineer"]);
  await withFlash(`/engineer/tickets/${ticketId}`, async () => {
    await saveTicketNotes(actor, ticketId, { effort: str(form, "effort"), feasibility: str(form, "feasibility"), dependencies: str(form, "dependencies"), notes: str(form, "notes") });
    revalidatePath("/", "layout");
    return "Technical notes saved. The PM sets the final effort.";
  });
}
