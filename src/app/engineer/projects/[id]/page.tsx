import Link from "next/link";
import { notFound } from "next/navigation";
import { Back, TicketStatus } from "@/components/ui";
import { getProject } from "@/domain/delivery";
import { projectActivity } from "@/domain/integrations";
import { requireActor } from "@/domain/session";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor(["engineer"]);
  const project = await getProject(actor, (await params).id);
  if (!project) notFound();
  const activity = await projectActivity(actor, project.id, 10);
  return (
    <>
      <Back href="/engineer/projects" label="Projects" />
      <div className="page-head">
        <div><span className="eyebrow">{project.accountName}</span><h1>{project.name}</h1></div>
        <span className="chip">{project.status[0].toUpperCase() + project.status.slice(1)}</span>
      </div>
      <dl className="meta-grid card" style={{ marginBottom: "1.5rem" }}>
        <div><dt>Client</dt><dd>{project.accountName} · {project.accountTier}</dd></div>
        <div><dt>Team</dt><dd>{project.team.join(", ") || "—"}</dd></div>
        <div><dt>Open tickets</dt><dd>{project.openTickets}</dd></div>
      </dl>
      <div className="grid split">
        <div>
          <div className="section-head"><h2>Delivery tickets</h2></div>
          <div className="card flush">
            <table className="stack-sm">
              <thead><tr><th scope="col">Ticket</th><th scope="col">Priority</th><th scope="col">Assignee</th><th scope="col">Status</th></tr></thead>
              <tbody>
                {project.tickets.map((t) => (
                  <tr key={t.id}>
                    <td className="primary"><span className="ticket-id">{t.key}</span><br /><Link className="row-link" href={`/engineer/tickets/${t.id}`}>{t.title}</Link></td>
                    <td data-label="Priority" className="prio">{t.priority ?? "—"}</td>
                    <td data-label="Assignee">{t.assignee ?? "Unassigned"}</td>
                    <td data-label="Status"><TicketStatus name={t.statusName} stage={t.stage} /></td>
                  </tr>
                ))}
                {!project.tickets.length && <tr><td colSpan={4} className="muted">No tickets yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <div className="section-head"><h2>Linked Customer Needs</h2></div>
          <div className="card flush list">
            {project.needs.map((n) => <div className="item" key={n.id}><Link className="btn-link" href={`/engineer/needs/${n.id}`}>{n.title}</Link></div>)}
            {!project.needs.length && <div className="item muted">None yet.</div>}
          </div>
          <div className="section-head" style={{ marginTop: "1.5rem" }}><h2>Recent approved updates</h2></div>
          <div className="card flush list">
            {project.updates.map((u) => <div className="item" key={u.id}><p className="strong">{u.subject}</p><p className="muted">{u.needTitle} · {u.sentAt?.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</p></div>)}
            {!project.updates.length && <div className="item muted">No approved updates yet.</div>}
          </div>
          {activity.length > 0 && (
            <>
              <div className="section-head" style={{ marginTop: "1.5rem" }}><h2>GitHub activity</h2></div>
              <div className="card flush list">
                {activity.map((a) => (
                  <div className="item" key={a.id}>
                    <a className="btn-link" href={a.url} target="_blank" rel="noreferrer">{a.kind === "pull_request" ? `PR #${a.ref}` : a.kind === "commit" ? `Commit ${a.ref.slice(0, 7)}` : `Branch ${a.ref}`}</a>
                    {a.kind !== "branch" && <> {a.title}</>} <span className="muted">· {a.ticketId ? <Link className="btn-link" href={`/engineer/tickets/${a.ticketId}`}>{a.ticketKey}</Link> : "not linked"}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
