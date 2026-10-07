import Link from "next/link";
import { notFound } from "next/navigation";
import { Back, Notice, TicketStatus, param, type SearchParams } from "@/components/ui";
import { TicketMove } from "@/components/ticket-move";
import { CommentForm, TeamTimeline } from "@/components/ticket-timeline";
import { getTicket } from "@/domain/delivery";
import { requireActor } from "@/domain/session";
import { PUBLIC_STATUS, publicStatusOf, teamTimeline } from "@/domain/tracking";
import { projectWorkflow } from "@/domain/workflow";
import { addTicketCommentAction, moveTicketAction } from "../../actions";
import { ReworkReview } from "./rework-review";

export const dynamic = "force-dynamic";

export default async function PmTicketPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const actor = await requireActor(["pm"]);
  const { id } = await params;
  const sp = await searchParams;
  const ticket = await getTicket(actor, id);
  if (!ticket) notFound();
  const [workflow, events] = await Promise.all([projectWorkflow(ticket.projectId), teamTimeline(id)]);
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
      <ReworkReview ticketId={id} actor={actor} back={`/pm/tickets/${id}`} />
      <div className="section grid split">
        <div className="card"><h2 style={{ marginBottom: ".9rem" }}>Updates</h2><TeamTimeline events={events} /></div>
        <div className="card"><CommentForm action={addTicketCommentAction.bind(null, id)} /></div>
      </div>
    </>
  );
}
