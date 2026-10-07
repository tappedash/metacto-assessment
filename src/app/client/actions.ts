"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { AttachmentView } from "@/domain/attachments";
import { addSupport, removeSupport } from "@/domain/feedback";
import { getNeed } from "@/domain/needs";
import { requireActor } from "@/domain/session";
import { confirmLooksGood, submitRework, understandRework, type ReworkContext } from "@/domain/validation";
import { withFlash } from "@/lib/flash";

export async function toggleSupport(needId: string, support: boolean) {
  const actor = await requireActor(["client"]);
  await withFlash(`/client/needs/${needId}`, async () => {
    if (!(await getNeed(needId))) throw new Error("Customer Need not found");
    if (support) await addSupport(actor.id, needId);
    else await removeSupport(actor.id, needId);
    revalidatePath("/", "layout");
    return support ? "You're supporting this need. We'll email you updates." : "Support removed.";
  });
}

// ---------- validating a released ticket ----------

export async function looksGoodAction(ticketId: string) {
  const actor = await requireActor(["client"]);
  await withFlash(`/client/tickets/${ticketId}`, async () => {
    await confirmLooksGood(actor, ticketId);
    revalidatePath("/", "layout");
    return "Thanks for confirming. The team can see it.";
  });
}

const Rework = z.object({
  ticketId: z.string().uuid(),
  description: z.string().trim().max(5000),
  attachmentIds: z.array(z.string().uuid()).max(5),
  correction: z.string().trim().max(1000).optional(),
});

export async function understandReworkAction(input: z.input<typeof Rework>): Promise<{ understanding: ReworkContext; attachments: AttachmentView[] } | { error: string }> {
  const actor = await requireActor(["client"]);
  const parsed = Rework.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    const { ticketId, ...rest } = parsed.data;
    return await understandRework(actor, ticketId, rest);
  } catch (error) {
    return { error: (error as Error).message };
  }
}

const Submit = Rework.omit({ correction: true }).extend({
  context: z.object({ summary: z.string().max(1000), expected: z.string().max(1000), actual: z.string().max(1000), impact: z.string().max(1000) }),
});

export async function submitReworkAction(input: z.input<typeof Submit>): Promise<{ ok: true } | { error: string }> {
  const actor = await requireActor(["client"]);
  const parsed = Submit.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    const { ticketId, ...rest } = parsed.data;
    await submitRework(actor, ticketId, rest);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return { error: (error as Error).message };
  }
}
