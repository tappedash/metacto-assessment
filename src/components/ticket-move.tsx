import type { SessionActor } from "@/domain/session";
import { allowedTicketMoves, type Stage } from "@/domain/permissions";
import type { StatusDef } from "@/domain/workflow";

interface MovableTicket {
  id: string;
  statusId: string;
  stage: Stage;
  statusPosition: number;
  assigneeId: string | null;
  assignee: string | null;
}

/**
 * "Move to…" for a ticket: only the statuses this actor may use, with the next status
 * in the project's workflow preselected. Explains why when nothing is allowed.
 */
export function TicketMove({ actor, ticket, statuses, action }: {
  actor: SessionActor;
  ticket: MovableTicket;
  statuses: StatusDef[];
  action: (form: FormData) => Promise<void>;
}) {
  const options = allowedTicketMoves(actor, ticket, statuses);
  if (!options.length) {
    if (ticket.stage === "backlog") return <span className="locked">PM moves it out of Backlog</span>;
    if (ticket.assigneeId !== actor.id) return <span className="locked">Assigned to {ticket.assignee ?? "nobody"}</span>;
    return null;
  }
  const currentIndex = statuses.findIndex((s) => s.id === ticket.statusId);
  const next = options.find((o) => statuses.findIndex((s) => s.id === o.id) > currentIndex) ?? options[0];
  return (
    <form action={action} className="btn-row">
      <label className="sr-only" htmlFor={`move-${ticket.id}`}>Move ticket to</label>
      <select id={`move-${ticket.id}`} name="to" defaultValue={next.id} style={{ margin: 0, width: "auto", minHeight: 32, padding: ".3rem .5rem", fontSize: 13 }}>
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      <button className="btn btn-dark btn-sm" type="submit">Move</button>
    </form>
  );
}
