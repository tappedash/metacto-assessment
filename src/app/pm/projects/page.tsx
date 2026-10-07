import Link from "next/link";
import { PageHead, TicketStatus } from "@/components/ui";
import { listProjects } from "@/domain/delivery";
import { requireActor } from "@/domain/session";
import { statusesFor } from "@/domain/workflow";

export const dynamic = "force-dynamic";

export default async function PmProjectsPage() {
  const actor = await requireActor(["pm"]);
  const projects = await listProjects(actor);
  const workflows = await statusesFor(projects.map((p) => p.id));
  const clients = [...new Map(projects.map((p) => [p.accountId, p.accountName])).entries()];
  return (
    <>
      <PageHead eyebrow="Projects" title="Ticket workflows per project"
        lede="Each project can use its own ticket statuses. Every status belongs to a stage (Backlog, Planned, In progress, Done), which keeps permissions and Customer Need progress working." />
      {clients.map(([accountId, accountName]) => (
        <div className="client-group" key={accountId}>
          <div className="section-head"><h2>{accountName}</h2></div>
          <div className="card flush list">
            {projects.filter((p) => p.accountId === accountId).map((p) => (
              <div className="item item-body" key={p.id}>
                <div>
                  <Link className="row-link" href={`/pm/projects/${p.id}`}>{p.name}</Link>
                  <p className="muted" style={{ margin: ".35rem 0" }}>{p.openTickets} open tickets · team {p.team.join(", ") || "—"}</p>
                  <div className="btn-row">{(workflows.get(p.id) ?? []).map((s) => <TicketStatus key={s.id} name={s.name} stage={s.stage} />)}</div>
                </div>
                <Link className="btn btn-ghost btn-sm" href={`/pm/projects/${p.id}`}>Configure statuses</Link>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
