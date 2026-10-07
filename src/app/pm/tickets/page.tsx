import Link from "next/link";
import { boardColumns } from "@/components/board-columns";
import { ReworkCallout } from "@/components/rework-callout";
import { TicketMove } from "@/components/ticket-move";
import { Notice, PageHead, TicketStatus, param, type SearchParams } from "@/components/ui";
import { listProjects, listTickets } from "@/domain/delivery";
import { requireActor } from "@/domain/session";
import { reworkRequests } from "@/domain/validation";
import { statusesFor } from "@/domain/workflow";
import { moveTicketAction } from "../actions";

export const dynamic = "force-dynamic";

// All projects: columns are the four stages and each card shows its project's own status.
// Pick a project to see its configured columns.
export default async function PmTicketsPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireActor(["pm"]);
  const sp = await searchParams;
  const projectId = param(sp.project);
  const [tickets, projects, reworks] = await Promise.all([listTickets(actor, { projectId }), listProjects(actor), reworkRequests(actor, { openOnly: true })]);
  const workflows = await statusesFor(projects.map((p) => p.id));
  const columns = boardColumns(tickets, projectId ? workflows.get(projectId) ?? null : null);
  const back = projectId ? `/pm/tickets?project=${projectId}` : "/pm/tickets";

  return (
    <>
      <PageHead eyebrow="Tickets" title="Delivery across projects"
        lede="Tickets are what Engineering is building; each links to the Customer Need that explains why. You move tickets out of Backlog; engineers move them through delivery." />
      <Notice notice={param(sp.notice)} error={param(sp.error)} />
      <ReworkCallout reworks={reworks} hrefFor={(id) => `/pm/tickets/${id}`} />
      <form className="toolbar" aria-label="Choose project">
        <label className="field">Project
          <select name="project" defaultValue={projectId}>
            <option value="">All projects (by stage)</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.accountName} · {p.name}</option>)}
          </select>
        </label>
        <button className="btn btn-ghost btn-sm" type="submit">Show</button>
        {projectId && <Link className="btn-link" href={`/pm/projects/${projectId}`}>Configure statuses</Link>}
      </form>
      <div className="board dyn" style={{ "--cols": columns.length } as React.CSSProperties}>
        {columns.map((col) => (
          <section className="col" key={col.key} aria-label={col.title}>
            <div className="col-head"><h2>{col.title}</h2><span>{col.cards.length}</span></div>
            {col.cards.map((t) => (
              <div className="ticket" key={t.id}>
                <span className="ticket-id">{t.key} · <span className="prio">{t.priority ?? "—"}</span> · Effort {t.effort ?? "—"}</span>
                <span className="t-title"><Link className="row-link" href={`/pm/tickets/${t.id}`}>{t.title}</Link></span>
                <span className="muted">{t.projectName} · {t.accountName}</span><br />
                <span className="muted">Customer Need: <Link className="btn-link" href={`/pm/needs/${t.needId}`}>{t.needTitle}</Link></span>
                <span className="meta">
                  {!projectId && <TicketStatus name={t.statusName} stage={t.stage} />}
                  <span className="chip">{t.assignee ?? "Unassigned"}</span>
                </span>
                <div style={{ marginTop: ".55rem" }}>
                  <TicketMove actor={actor} ticket={t} statuses={workflows.get(t.projectId) ?? []} action={moveTicketAction.bind(null, t.id, back)} />
                </div>
              </div>
            ))}
            {!col.cards.length && <p className="muted" style={{ padding: ".3rem" }}>No tickets</p>}
          </section>
        ))}
      </div>
    </>
  );
}
