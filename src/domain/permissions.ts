// Server-side permission rules (spec v0.2 §3). Pure functions so they are easy to test
// and impossible to bypass from the UI.

export type Role = "admin" | "pm" | "engineer" | "client";
export type Stage = "backlog" | "planned" | "in_progress" | "done";

export interface Actor {
  id: string;
  role: Role;
  accountId?: string | null; // client users
  staffedAccountIds?: string[]; // engineers
}

/** Raw Feature Requests (evidence) for an account. */
export function canViewAccountEvidence(actor: Actor, accountId: string): boolean {
  switch (actor.role) {
    case "admin":
    case "pm":
      return true;
    case "engineer":
      return actor.staffedAccountIds?.includes(accountId) ?? false;
    case "client":
      return actor.accountId === accountId;
  }
}

/** Contract value / ARR is Admin + PM only. */
export function canSeeContractValue(actor: Actor): boolean {
  return actor.role === "admin" || actor.role === "pm";
}

export function canDecideOnNeed(actor: Actor): boolean {
  return actor.role === "pm";
}

/**
 * Project statuses an actor may move a ticket to. Statuses are configured per project;
 * the rules use their stage: only the PM moves tickets out of Backlog, and engineers move
 * their own tickets between any non-Backlog statuses.
 */
export function allowedTicketMoves<S extends { id: string; stage: Stage }>(
  actor: Actor,
  ticket: { assigneeId: string | null; statusId: string; stage: Stage },
  projectStatuses: S[],
): S[] {
  const others = projectStatuses.filter((s) => s.id !== ticket.statusId);
  if (actor.role === "pm") return others;
  if (actor.role === "engineer" && ticket.assigneeId === actor.id && ticket.stage !== "backlog") {
    return others.filter((s) => s.stage !== "backlog");
  }
  return [];
}

export interface NeedRecord {
  id: string;
  title: string;
  problemStatement: string;
  status: string;
  publicRationale: string | null;
  priority?: string | null;
  rubricAi?: unknown;
  rubricFinal?: unknown;
  aiBrief?: unknown;
}

/** What a client user may see of a Customer Need: public fields only. */
export function toPublicNeed(need: NeedRecord, supporterCount: number) {
  return {
    id: need.id,
    title: need.title,
    problemStatement: need.problemStatement,
    status: need.status,
    publicRationale: need.publicRationale,
    supporterCount,
  };
}
