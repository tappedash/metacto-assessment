import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { projectStatuses, tickets } from "@/db/schema";
import type { Actor } from "./permissions";

// Per-project ticket workflows. The PM names and orders statuses freely; each status
// is tagged with a fixed stage, and every product rule uses the stage, never the name.

export const STAGES = ["backlog", "planned", "in_progress", "done"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  backlog: "Backlog",
  planned: "Planned",
  in_progress: "In progress",
  done: "Done",
};

export const DEFAULT_WORKFLOW: { name: string; stage: Stage }[] = [
  { name: "Backlog", stage: "backlog" },
  { name: "Planned", stage: "planned" },
  { name: "In Development", stage: "in_progress" },
  { name: "Released", stage: "done" },
];

export interface StatusDef {
  id: string;
  projectId: string;
  name: string;
  stage: Stage;
  position: number;
}

/**
 * A workflow is valid when names are present and unique, there is somewhere to start
 * (a Backlog status) and somewhere to finish (a Done status), and stages never go
 * backwards in the order shown on the board.
 */
export function validateWorkflow(statuses: { name: string; stage: Stage }[]): string | null {
  if (statuses.some((s) => !s.name.trim())) return "Every status needs a name.";
  const names = statuses.map((s) => s.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) return "Status names must be unique within a project.";
  if (!statuses.some((s) => s.stage === "backlog")) return "Keep at least one Backlog status, so new tickets have somewhere to start.";
  if (!statuses.some((s) => s.stage === "done")) return "Keep at least one Done status, so tickets can be finished.";
  for (let i = 1; i < statuses.length; i++) {
    if (STAGES.indexOf(statuses[i].stage) < STAGES.indexOf(statuses[i - 1].stage)) return "Stages must stay in order: Backlog, Planned, In progress, Done.";
  }
  return null;
}

/** Board order: by stage, then the PM's position within the stage. */
export function sortStatuses<T extends { stage: Stage; position: number }>(statuses: T[]): T[] {
  return [...statuses].sort((a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage) || a.position - b.position);
}

export async function statusesFor(projectIds: string[]): Promise<Map<string, StatusDef[]>> {
  const map = new Map<string, StatusDef[]>();
  if (!projectIds.length) return map;
  const rows = await getDb().select().from(projectStatuses).where(inArray(projectStatuses.projectId, projectIds)).orderBy(asc(projectStatuses.position));
  for (const id of projectIds) map.set(id, sortStatuses(rows.filter((r) => r.projectId === id) as StatusDef[]));
  return map;
}

export async function projectWorkflow(projectId: string): Promise<StatusDef[]> {
  return (await statusesFor([projectId])).get(projectId) ?? [];
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/** New projects start from the default workflow. */
export async function createDefaultWorkflow(tx: Tx | ReturnType<typeof getDb>, projectId: string, workflow = DEFAULT_WORKFLOW) {
  await tx.insert(projectStatuses).values(workflow.map((s, position) => ({ projectId, ...s, position })));
}

function assertPm(actor: Actor) {
  if (actor.role !== "pm") throw new Error("Only the Product Manager can configure ticket statuses");
}

/** Apply a change to one project's workflow atomically: edit the list, validate, renumber. */
async function changeWorkflow(projectId: string, edit: (list: StatusDef[], tx: Tx) => Promise<StatusDef[]> | StatusDef[]) {
  await getDb().transaction(async (tx) => {
    const current = sortStatuses((await tx.select().from(projectStatuses).where(eq(projectStatuses.projectId, projectId))) as StatusDef[]);
    if (!current.length) throw new Error("Project not found");
    const next = await edit(current, tx);
    const problem = validateWorkflow(next);
    if (problem) throw new Error(problem);
    // Renumber in board order (temporary offset avoids clashing with existing positions).
    for (const [i, s] of next.entries()) {
      await tx.update(projectStatuses).set({ name: s.name.trim(), stage: s.stage, position: 1000 + i }).where(eq(projectStatuses.id, s.id));
    }
    await tx.execute(sql`UPDATE project_statuses SET position = position - 1000 WHERE project_id = ${projectId}::uuid`);
  });
}

export async function addStatus(actor: Actor, projectId: string, name: string, stage: Stage) {
  assertPm(actor);
  await changeWorkflow(projectId, async (list, tx) => {
    const [row] = await tx.insert(projectStatuses).values({ projectId, name: name.trim(), stage, position: 10_000 }).returning();
    // Insert at the end of its stage group.
    const lastInStage = list.map((s) => STAGES.indexOf(s.stage)).lastIndexOf(STAGES.indexOf(stage));
    const at = lastInStage >= 0 ? lastInStage + 1 : list.findIndex((s) => STAGES.indexOf(s.stage) > STAGES.indexOf(stage));
    const next = [...list];
    next.splice(at < 0 ? next.length : at, 0, row as StatusDef);
    return next;
  });
}

export async function updateStatus(actor: Actor, statusId: string, input: { name: string; stage: Stage }) {
  assertPm(actor);
  const [status] = await getDb().select().from(projectStatuses).where(eq(projectStatuses.id, statusId));
  if (!status) throw new Error("Status not found");
  await changeWorkflow(status.projectId, (list) => {
    const others = list.filter((s) => s.id !== statusId);
    const edited = { ...(status as StatusDef), name: input.name, stage: input.stage };
    if (edited.stage === status.stage) return list.map((s) => (s.id === statusId ? edited : s));
    // A new stage moves the status to the end of that stage's group.
    return sortStatuses([...others, { ...edited, position: 10_000 }]);
  });
}

export async function moveStatus(actor: Actor, statusId: string, direction: "up" | "down") {
  assertPm(actor);
  const [status] = await getDb().select().from(projectStatuses).where(eq(projectStatuses.id, statusId));
  if (!status) throw new Error("Status not found");
  await changeWorkflow(status.projectId, (list) => {
    const i = list.findIndex((s) => s.id === statusId);
    const j = direction === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= list.length || list[j].stage !== list[i].stage) throw new Error("Statuses can only be reordered within their stage.");
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
}

/** Remove a status; its tickets move to the replacement status in the same project. */
export async function removeStatus(actor: Actor, statusId: string, replacementId: string | null) {
  assertPm(actor);
  const [status] = await getDb().select().from(projectStatuses).where(eq(projectStatuses.id, statusId));
  if (!status) throw new Error("Status not found");
  await changeWorkflow(status.projectId, async (list, tx) => {
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(tickets).where(eq(tickets.statusId, statusId));
    if (n > 0) {
      const replacement = list.find((s) => s.id === replacementId && s.id !== statusId);
      if (!replacement) throw new Error(`${n} ticket${n === 1 ? " uses" : "s use"} "${status.name}". Choose where to move ${n === 1 ? "it" : "them"}.`);
      await tx.update(tickets).set({ statusId: replacement.id }).where(eq(tickets.statusId, statusId));
    }
    const next = list.filter((s) => s.id !== statusId);
    const problem = validateWorkflow(next);
    if (problem) throw new Error(problem);
    await tx.delete(projectStatuses).where(and(eq(projectStatuses.id, statusId), eq(projectStatuses.projectId, status.projectId)));
    return next;
  });
}

export async function ticketCountsByStatus(projectId: string): Promise<Map<string, number>> {
  const rows = await getDb()
    .select({ statusId: tickets.statusId, n: sql<number>`count(*)::int` })
    .from(tickets).where(eq(tickets.projectId, projectId)).groupBy(tickets.statusId);
  return new Map(rows.map((r) => [r.statusId, r.n]));
}
