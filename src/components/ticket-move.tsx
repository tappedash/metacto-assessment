import { moveMyTicketAction } from "@/app/engineer/actions";
import type { SessionActor } from "@/domain/session";
import { allowedTicketMoves, type TicketStatus } from "@/domain/permissions";

const VERB: Record<string, string> = { in_development: "Start development", released: "Mark released" };

/** Engineer's allowed delivery move for a ticket, or why it can't be moved. */
export function TicketMove({ actor, ticket, back }: { actor: SessionActor; ticket: { id: string; status: string; assigneeId: string | null; assignee: string | null }; back: string }) {
  const [next] = allowedTicketMoves(actor, { assigneeId: ticket.assigneeId, status: ticket.status as TicketStatus });
  if (next) {
    return (
      <form action={moveMyTicketAction.bind(null, ticket.id, next, back)}>
        <button className="btn btn-dark btn-sm" type="submit">{VERB[next] ?? "Move"}</button>
      </form>
    );
  }
  if (ticket.status === "backlog") return <span className="locked">PM moves to Planned</span>;
  if (ticket.assigneeId !== actor.id && ticket.status !== "released") return <span className="locked">Assigned to {ticket.assignee ?? "nobody"}</span>;
  return null;
}
