"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Understanding } from "@/domain/ai-tasks";
import type { AttachmentView } from "@/domain/attachments";
import { checkFeedback, contextToWhy, submitFeedback, understandFeedback, type CheckResult, type MatchView, type SubmitOutcome } from "@/domain/feedback";
import { requireActor } from "@/domain/session";

// Server actions for Feature Request intake. The role is checked on every call.

const Check = z.object({
  title: z.string().trim().min(3, "Tell us what you need (at least 3 characters)").max(200),
  why: z.string().trim().max(2000),
  skipFollowUp: z.boolean().optional(),
});

export async function checkFeedbackAction(input: z.input<typeof Check>): Promise<CheckResult | { kind: "error"; error: string }> {
  await requireActor(["client", "engineer"]);
  const parsed = Check.safeParse(input);
  if (!parsed.success) return { kind: "error", error: parsed.error.issues[0].message };
  try {
    return await checkFeedback({ title: parsed.data.title, why: parsed.data.why }, { skipFollowUp: parsed.data.skipFollowUp });
  } catch (error) {
    return { kind: "error", error: (error as Error).message };
  }
}

// ---------- client: understand (description + details + files) -> confirm -> match ----------

const Understand = z.object({
  title: z.string().trim().max(200),
  details: z.string().trim().max(5000),
  attachmentIds: z.array(z.string().uuid()).max(5),
});

export async function understandFeedbackAction(input: z.input<typeof Understand>): Promise<{ understanding: Understanding; attachments: AttachmentView[] } | { error: string }> {
  const actor = await requireActor(["client"]);
  const parsed = Understand.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    return await understandFeedback(actor, parsed.data);
  } catch (error) {
    return { error: (error as Error).message };
  }
}

const Context = z.object({
  summary: z.string().max(1000),
  goal: z.string().max(1000),
  workaround: z.string().max(1000),
  impact: z.string().max(1000),
  terms: z.array(z.string().max(60)).max(10),
});

/** Match using what the customer confirmed (or corrected). */
export async function matchConfirmedAction(input: { title: string; context: z.input<typeof Context> }): Promise<{ match: MatchView } | { error: string }> {
  await requireActor(["client"]);
  const title = z.string().trim().min(3, "Give your request a short title").max(200).safeParse(input.title);
  const ctx = Context.safeParse(input.context);
  if (!title.success) return { error: title.error.issues[0].message };
  if (!ctx.success) return { error: ctx.error.issues[0].message };
  try {
    const result = await checkFeedback({ title: title.data, why: [contextToWhy(ctx.data), ctx.data.terms.join(", ")].filter(Boolean).join(" ") }, { skipFollowUp: true });
    return result.kind === "match" ? { match: result.match } : { error: "Couldn't check for matching needs" };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

const Submit = z.object({
  title: z.string().trim().min(3).max(200),
  why: z.string().trim().max(2000),
  choice: z.enum(["support", "different"]),
  needId: z.string().uuid().nullable(),
  relation: z.enum(["same", "related", "new", "triage"]),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(1000),
  accountId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  context: Context.optional(),
  attachmentIds: z.array(z.string().uuid()).max(5).optional(),
});

export async function submitFeedbackAction(input: z.input<typeof Submit>): Promise<SubmitOutcome | { error: string }> {
  const actor = await requireActor(["client", "engineer"]);
  const parsed = Submit.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    const outcome = await submitFeedback(actor, parsed.data);
    revalidatePath("/", "layout");
    return outcome;
  } catch (error) {
    return { error: (error as Error).message };
  }
}
