"use server";

import { revalidatePath } from "next/cache";
import { moveTicket, saveTicketNotes } from "@/domain/delivery";
import type { TicketStatus } from "@/domain/permissions";
import { requireActor } from "@/domain/session";
import { str, withFlash } from "@/lib/flash";

export async function moveMyTicketAction(ticketId: string, to: TicketStatus, back: string) {
  const actor = await requireActor(["engineer"]);
  await withFlash(back, async () => {
    const { needStatusChanged } = await moveTicket(actor, ticketId, to);
    revalidatePath("/", "layout");
    return needStatusChanged ? "Ticket moved. AI drafted a customer update for the PM to approve." : "Ticket moved.";
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
