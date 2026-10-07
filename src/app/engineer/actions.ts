"use server";

import { revalidatePath } from "next/cache";
import { moveTicket, saveTicketNotes } from "@/domain/delivery";
import { requireActor } from "@/domain/session";
import { str, withFlash } from "@/lib/flash";

export async function moveMyTicketAction(ticketId: string, back: string, form: FormData) {
  const actor = await requireActor(["engineer"]);
  await withFlash(back, async () => {
    const { needStatusChanged, status } = await moveTicket(actor, ticketId, str(form, "to"));
    revalidatePath("/", "layout");
    return needStatusChanged ? `Moved to ${status}. AI drafted a customer update for the PM to approve.` : `Moved to ${status}.`;
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
