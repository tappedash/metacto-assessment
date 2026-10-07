import Link from "next/link";
import { notFound } from "next/navigation";
import { Back, Notice, TicketStatus, param, type SearchParams } from "@/components/ui";
import { TicketMove } from "@/components/ticket-move";
import { TicketEngineering } from "@/components/integrations";
import { ReworkReview } from "@/components/rework-review";
import { CommentForm, TeamTimeline } from "@/components/ticket-timeline";
import { engineers, getTicket } from "@/domain/delivery";
import { requireActor } from "@/domain/session";
import { PUBLIC_STATUS, publicStatusOf, teamTimeline } from "@/domain/tracking";
import { projectIntegrationsFor, ticketActivity } from "@/domain/integrations";
import { reworkRequests } from "@/domain/validation";
import { projectWorkflow } from "@/domain/workflow";
import { addTicketCommentAction, moveTicketAction, publishUpdateAction, reviewReworkAction, updateTicketAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function PmTicketPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const actor = await requireActor(["pm"]);
  const { id } = await params;
  const sp = await searchParams;
  const ticket = await getTicket(actor, id);
  if (!ticket) notFound();
  const [workflow, events, reworks, people, activity, integrations] = await Promise.all([projectWorkflow(ticket.projectId), teamTimeline(id), reworkRequests(actor, { ticketId: id }), engineers(), ticketActivity(actor, id), projectIntegrationsFor(ticket.projectId)]);
  const current = workflow.find((s) => s.id === ticket.statusId)!;
  const pub = publicStatusOf(current);

  return (
    <>
      <Back href="/pm/tickets" label="Tickets" />
      <Notice notice={param(sp.notice)} error={param(sp.error)} />
      <div className="page-head">
        <div>
          <span className="ticket-id">{ticket.key} · {ticket.projectName} · {ticket.accountName}</span>
          <h1>{ticket.title}</h1>
          <p className="lede">Why: <Link className="btn-link" href={`/pm/needs/${ticket.needId}`}>{ticket.needTitle}</Link></p>
        </div>
        <TicketMove actor={actor} ticket={ticket} statuses={workflow} action={moveTicketAction.bind(null, id, `/pm/tickets/${id}`)} />
      </div>
      <dl className="meta-grid card">
        <div><dt>Status</dt><dd><TicketStatus name={ticket.statusName} stage={ticket.stage} /></dd></div>
        <div><dt>Customers see</dt><dd>{pub ? PUBLIC_STATUS[pub].label : "Nothing yet (Backlog)"}</dd></div>
        <div><dt>Assignee</dt><dd>{ticket.assignee ?? "Unassigned"}</dd></div>
      </dl>
      <form className="toolbar section" action={updateTicketAction.bind(null, id)} aria-label="Assignment and priority">
        <label className="field">Assignee
          <select name="assigneeId" defaultValue={ticket.assigneeId ?? ""}>
            <option value="">Unassigned</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="field">Priority
          <select name="priority" defaultValue={ticket.priority ?? ""}>
            <option value="">None</option>
            {["P0", "P1", "P2", "P3"].map((p) => <option key={p}>{p}</option>)}
          </select>
        </label>
        <button className="btn btn-ghost btn-sm" type="submit">Save</button>
      </form>
      <TicketEngineering ticket={ticket} activity={activity} jiraConnected={Boolean(integrations.jira?.enabled)} canLink />
      <ReworkReview reworks={reworks} action={reviewReworkAction.bind(null, id)} canFollowUp />
      <div className="section grid split">
        <div className="card"><h2 style={{ marginBottom: ".9rem" }}>Updates</h2><TeamTimeline events={events} publish={publishUpdateAction.bind(null, id)} /></div>
        <div className="card"><CommentForm action={addTicketCommentAction.bind(null, id)} /></div>
      </div>
    </>
  );
}
