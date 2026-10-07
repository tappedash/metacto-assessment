"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { approveAndSend, ensureNeedInsights, saveDecision, type DecisionInput } from "@/domain/decisions";
import { createTicket, moveTicket, updateTicket } from "@/domain/delivery";
import { RUBRIC_KEYS } from "@/domain/ai-tasks";
import { requireActor } from "@/domain/session";
import { acceptSuggestion, createNeed, mergeNeeds, moveToNeed } from "@/domain/triage";
import { addComment, publishUpdate } from "@/domain/tracking";
import { reviewRework } from "@/domain/validation";
import { addStatus, moveStatus, removeStatus, updateStatus, type Stage } from "@/domain/workflow";
import { str, withFlash } from "@/lib/flash";

// PM server actions. Each re-checks the role before touching data.

const refresh = () => revalidatePath("/", "layout");

export async function acceptTriageAction(requestId: string) {
  const actor = await requireActor(["pm"]);
  await withFlash("/pm/triage", async () => { await acceptSuggestion(actor, requestId); refresh(); return "Accepted into the suggested Customer Need."; });
}

export async function moveTriageAction(requestId: string, form: FormData) {
  const actor = await requireActor(["pm"]);
  await withFlash("/pm/triage", async () => { await moveToNeed(actor, requestId, str(form, "needId")); refresh(); return "Moved to the chosen Customer Need."; });
}

export async function createNeedAction(requestId: string) {
  const actor = await requireActor(["pm"]);
  await withFlash("/pm/triage", async () => { await createNeed(actor, requestId); refresh(); return "New Customer Need created from this request."; });
}

export async function regenerateInsightsAction(needId: string) {
  const actor = await requireActor(["pm"]);
  await withFlash(`/pm/needs/${needId}`, async () => { await ensureNeedInsights(needId, actor, { force: true }); refresh(); return "AI Brief and rubric regenerated."; });
}

export async function saveDecisionAction(needId: string, form: FormData) {
  const actor = await requireActor(["pm"]);
  const rubricFinal: Record<string, number> = {};
  for (const key of [...RUBRIC_KEYS, "effort"]) {
    const n = Number(form.get(`final_${key}`));
    if (Number.isFinite(n) && n >= 1 && n <= 5) rubricFinal[key] = Math.round(n);
  }
  const input: DecisionInput = {
    decision: (str(form, "decision") || "plan") as DecisionInput["decision"],
    priority: (str(form, "priority") || null) as DecisionInput["priority"],
    rationale: str(form, "rationale"),
    rubricFinal,
  };
  // After a status change the PM goes straight to the drafted update.
  let target: string;
  try {
    const { updateId } = await saveDecision(actor, needId, input);
    refresh();
    target = updateId
      ? `/pm/updates?notice=${encodeURIComponent("Decision saved. AI drafted a customer update for your approval.")}`
      : `/pm/needs/${needId}?notice=${encodeURIComponent("Decision saved.")}`;
  } catch (error) {
    target = `/pm/needs/${needId}?error=${encodeURIComponent((error as Error).message)}`;
  }
  redirect(target);
}

export async function mergeNeedAction(needId: string, form: FormData) {
  const actor = await requireActor(["pm"]);
  const targetId = str(form, "targetId");
  await withFlash(`/pm/needs/${targetId || needId}`, async () => { await mergeNeeds(actor, needId, targetId); refresh(); return "Customer Needs merged; evidence, supporters and tickets combined."; });
}

export async function createTicketAction(needId: string, form: FormData) {
  const actor = await requireActor(["pm"]);
  await withFlash(`/pm/needs/${needId}`, async () => {
    const t = await createTicket(actor, {
      needId, projectId: str(form, "projectId"), title: str(form, "title"),
      priority: str(form, "priority") || null, effort: str(form, "effort") || null, assigneeId: str(form, "assigneeId") || null,
    });
    refresh();
    return `${t.key} created in the backlog.`;
  });
}

export async function moveTicketAction(ticketId: string, back: string, form: FormData) {
  const actor = await requireActor(["pm"]);
  await withFlash(back, async () => {
    const { needStatusChanged, status } = await moveTicket(actor, ticketId, str(form, "to"));
    refresh();
    return needStatusChanged ? `Moved to ${status}. Customer Need status changed; AI drafted an update for approval.` : `Moved to ${status}.`;
  });
}

export async function addTicketCommentAction(ticketId: string, form: FormData) {
  const actor = await requireActor(["pm"]);
  await withFlash(`/pm/tickets/${ticketId}`, async () => {
    const visibility = str(form, "visibility") === "customer" ? "customer" : "internal";
    await addComment(actor, ticketId, str(form, "body"), visibility);
    refresh();
    return visibility === "customer" ? "Update posted. Customers following this can see it." : "Internal update posted.";
  });
}

export async function publishUpdateAction(ticketId: string, eventId: string) {
  const actor = await requireActor(["pm"]);
  await withFlash(`/pm/tickets/${ticketId}`, async () => {
    await publishUpdate(actor, eventId);
    refresh();
    return "Published. Customers following this ticket were notified.";
  });
}

export async function updateTicketAction(ticketId: string, form: FormData) {
  const actor = await requireActor(["pm"]);
  await withFlash(`/pm/tickets/${ticketId}`, async () => {
    await updateTicket(actor, ticketId, { assigneeId: str(form, "assigneeId") || null, priority: str(form, "priority") || null });
    refresh();
    return "Ticket updated.";
  });
}

export async function reviewReworkAction(ticketId: string, validationId: string, form: FormData) {
  const actor = await requireActor(["pm"]);
  await withFlash(`/pm/tickets/${ticketId}`, async () => {
    const choice = str(form, "decision");
    const decision = choice === "reopen" || choice === "follow_up" ? choice : "decline";
    await reviewRework(actor, validationId, decision, str(form, "note"));
    refresh();
    return decision === "reopen" ? "Ticket reopened. The customer sees it back In Development."
      : decision === "follow_up" ? "Follow-up ticket created as Planned. The customer can track it." : "Decision sent to the customer.";
  });
}

// ---------- per-project ticket workflow ----------

export async function addStatusAction(projectId: string, form: FormData) {
  const actor = await requireActor(["pm"]);
  await withFlash(`/pm/projects/${projectId}`, async () => {
    await addStatus(actor, projectId, str(form, "name"), str(form, "stage") as Stage);
    refresh();
    return `Added "${str(form, "name")}".`;
  });
}

export async function updateStatusAction(projectId: string, statusId: string, form: FormData) {
  const actor = await requireActor(["pm"]);
  await withFlash(`/pm/projects/${projectId}`, async () => {
    await updateStatus(actor, statusId, { name: str(form, "name"), stage: str(form, "stage") as Stage, readyForReview: str(form, "customerLabel") === "ready_for_review" });
    refresh();
    return "Status saved.";
  });
}

export async function moveStatusAction(projectId: string, statusId: string, direction: "up" | "down") {
  const actor = await requireActor(["pm"]);
  await withFlash(`/pm/projects/${projectId}`, async () => { await moveStatus(actor, statusId, direction); refresh(); return "Order saved."; });
}

export async function removeStatusAction(projectId: string, statusId: string, form: FormData) {
  const actor = await requireActor(["pm"]);
  await withFlash(`/pm/projects/${projectId}`, async () => {
    await removeStatus(actor, statusId, str(form, "replacementId") || null);
    refresh();
    return "Status removed.";
  });
}

export async function approveUpdateAction(updateId: string, form: FormData) {
  const actor = await requireActor(["pm"]);
  await withFlash("/pm/updates", async () => {
    const result = await approveAndSend(actor, updateId, { subject: str(form, "subject"), body: str(form, "body") });
    refresh();
    if (result.failed.length) throw new Error(`Sent to ${result.sent}; failed for ${result.failed.map((f) => f.email).join(", ")}.`);
    return `Update approved and emailed to ${result.sent} recipient${result.sent === 1 ? "" : "s"}.`;
  });
}
