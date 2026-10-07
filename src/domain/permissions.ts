// Server-side permission rules (spec v0.2 §3). Pure functions so they are easy to test
// and impossible to bypass from the UI.

export type Role = "admin" | "pm" | "engineer" | "client";
export type TicketStatus = "backlog" | "planned" | "in_development" | "released";

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

const ENGINEER_MOVES: Partial<Record<TicketStatus, TicketStatus>> = {
  planned: "in_development",
  in_development: "released",
};

/** Delivery states an actor may move a ticket to. Backlog -> Planned is a PM decision. */
export function allowedTicketMoves(actor: Actor, ticket: { assigneeId: string | null; status: TicketStatus }): TicketStatus[] {
  if (actor.role === "pm") return (["backlog", "planned", "in_development", "released"] as const).filter((s) => s !== ticket.status);
  if (actor.role === "engineer" && ticket.assigneeId === actor.id) {
    const next = ENGINEER_MOVES[ticket.status];
    return next ? [next] : [];
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
