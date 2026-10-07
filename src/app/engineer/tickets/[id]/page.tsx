import Link from "next/link";
import { notFound } from "next/navigation";
import { Back, Notice, TicketStatus, param, type SearchParams } from "@/components/ui";
import { TicketMove } from "@/components/ticket-move";
import { getTicket } from "@/domain/delivery";
import { getNeed, needSignals } from "@/domain/needs";
import { requireActor } from "@/domain/session";
import { projectWorkflow } from "@/domain/workflow";
import { ReworkReview } from "@/components/rework-review";
import { CommentForm, PmInputForm, TeamTimeline } from "@/components/ticket-timeline";
import { teamTimeline } from "@/domain/tracking";
import { reworkRequests } from "@/domain/validation";
import { addCommentAction, moveMyTicketAction, requestPmInputAction, reviewReworkAction, saveNotesAction } from "../../actions";

export const dynamic = "force-dynamic";

// Ticket detail: "Why are we building this?" is always one click away (Ticket -> Need -> evidence).
export default async function TicketPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const actor = await requireActor(["engineer"]);
  const { id } = await params;
  const sp = await searchParams;
  const ticket = await getTicket(actor, id);
  if (!ticket) notFound();
  const [need, signals, workflow, events, reworks] = await Promise.all([getNeed(ticket.needId), needSignals([ticket.needId]), projectWorkflow(ticket.projectId), teamTimeline(id), reworkRequests(actor, { ticketId: id })]);
  const s = signals.get(ticket.needId)!;
  const mine = ticket.assigneeId === actor.id;

  return (
    <>
      <Back href="/engineer/work" label="My Work" />
      <Notice notice={param(sp.notice)} error={param(sp.error)} />
      <div className="page-head">
        <div><span className="ticket-id">{ticket.key}</span><h1>{ticket.title}</h1></div>
        <TicketMove actor={actor} ticket={ticket} statuses={workflow} action={moveMyTicketAction.bind(null, id, `/engineer/tickets/${id}`)} />
      </div>

      <div className="card why-panel" style={{ marginBottom: "1rem" }}>
        <span className="eyebrow">Why are we building this?</span>
        <p><Link className="btn-link" style={{ fontSize: "1rem" }} href={`/engineer/needs/${ticket.needId}`}>{ticket.needTitle}</Link></p>
        <p className="muted" style={{ marginTop: ".3rem" }}>{need?.problemStatement}</p>
        <p className="muted" style={{ marginTop: ".3rem" }}>Demand: {s.requests} Feature Requests · {s.supporters} supporters · {s.accounts} accounts</p>
      </div>

      <dl className="meta-grid card">
        <div><dt>Project</dt><dd><Link className="btn-link" href={`/engineer/projects/${ticket.projectId}`}>{ticket.projectName}</Link></dd></div>
        <div><dt>Client</dt><dd><Link className="btn-link" href={`/engineer/projects#client-${ticket.accountId}`}>{ticket.accountName}</Link></dd></div>
        <div><dt>Status</dt><dd><TicketStatus name={ticket.statusName} stage={ticket.stage} /> <span className="muted">{workflow.map((s) => s.name).join(" → ")}</span></dd></div>
        <div><dt>Priority</dt><dd className="prio">{ticket.priority ?? "—"}</dd></div>
        <div><dt>Assignee</dt><dd>{ticket.assignee ?? "Unassigned"}{mine ? " (you)" : ""}</dd></div>
        <div><dt>Effort</dt><dd>{ticket.effort ?? "Not estimated"}</dd></div>
      </dl>

      <ReworkReview reworks={reworks} action={reviewReworkAction.bind(null, id)} />

      <div className="section grid split">
        <div className="card">
          <h2 style={{ marginBottom: ".9rem" }}>Updates</h2>
          <TeamTimeline events={events} />
        </div>
        <div className="card stack"><CommentForm action={addCommentAction.bind(null, id)} needsApproval /><PmInputForm action={requestPmInputAction.bind(null, id)} /></div>
      </div>

      <form className="section card" action={saveNotesAction.bind(null, id)}>
        <h2 style={{ marginBottom: "1rem" }}>Technical notes</h2>
        <fieldset disabled={!mine} style={{ border: 0, padding: 0, margin: 0 }}>
          <div className="grid g2">
            <label className="field">Effort estimate
              <select name="effort" defaultValue={ticket.effort ?? "M"}>{["S", "M", "L", "XL"].map((e) => <option key={e}>{e}</option>)}</select>
            </label>
            <label className="field">Dependencies<input type="text" name="dependencies" defaultValue={ticket.dependencies ?? ""} /></label>
          </div>
          <label className="field">Feasibility<textarea name="feasibility" defaultValue={ticket.feasibility ?? ""} /></label>
          <label className="field">Notes<textarea name="notes" defaultValue={ticket.notes ?? ""} placeholder="Implementation notes, risks, open questions…" /></label>
          {mine ? <button className="btn btn-primary" type="submit">Save notes</button> : <p className="locked">Only the assignee can edit these notes.</p>}
        </fieldset>
      </form>
    </>
  );
}
