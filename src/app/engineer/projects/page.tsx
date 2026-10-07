import Link from "next/link";
import { PageHead } from "@/components/ui";
import { listProjects } from "@/domain/delivery";
import { requireActor } from "@/domain/session";

export const dynamic = "force-dynamic";

const STATUS_CHIP: Record<string, string> = { active: "st-dev", planning: "st-planned", done: "st-released" };

export default async function ProjectsPage() {
  const actor = await requireActor(["engineer"]);
  const projects = await listProjects(actor);
  const clients = [...new Map(projects.map((p) => [p.accountId, p])).values()];
  return (
    <>
      <PageHead eyebrow="Projects" title="Your engagements" lede="Client → Project → Ticket. Open a project to see its team, Customer Needs and tickets." />
      {clients.map((c) => (
        <div className="client-group" id={`client-${c.accountId}`} key={c.accountId}>
          <div className="section-head"><h2>{c.accountName}</h2><span className="chip">{c.accountTier} · {c.accountSegment}</span></div>
          <div className="card flush list">
            {projects.filter((p) => p.accountId === c.accountId).map((p) => (
              <div className="item item-body" key={p.id}>
                <div>
                  <Link className="row-link" href={`/engineer/projects/${p.id}`}>{p.name}</Link>
                  <p className="muted">Team: {p.team.join(", ") || "—"} · {p.openTickets} open tickets</p>
                  <p className="muted">Customer Needs: {p.needs.length ? p.needs.map((n, i) => <span key={n.id}>{i > 0 && ", "}<Link className="btn-link" href={`/engineer/needs/${n.id}`}>{n.title}</Link></span>) : "—"}</p>
                </div>
                <span className={`chip ${STATUS_CHIP[p.status]}`}>{p.status[0].toUpperCase() + p.status.slice(1)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
      {!clients.length && <div className="card empty"><h2>No engagements yet</h2><p className="muted">Ask your Workspace Admin to staff you on a client.</p></div>}
    </>
  );
}
