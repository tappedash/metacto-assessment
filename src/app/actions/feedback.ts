"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkFeedback, submitFeedback, type CheckResult, type SubmitOutcome } from "@/domain/feedback";
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
