"use server";

import { z } from "zod";
import { askAssistant, type AssistantAnswer } from "@/domain/assistant";
import { requireActor } from "@/domain/session";

const Ask = z.object({
  question: z.string().trim().min(1).max(1000),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(2000) })).max(12),
  pageNeedId: z.string().uuid().optional(),
  attachmentId: z.string().uuid().optional(),
});

export async function askAssistantAction(input: z.input<typeof Ask>): Promise<AssistantAnswer> {
  const actor = await requireActor(["client"]);
  const parsed = Ask.safeParse(input);
  if (!parsed.success) return { answer: "Ask me about your requests, the needs you support, or their latest updates.", links: [] };
  return askAssistant(actor, parsed.data);
}
