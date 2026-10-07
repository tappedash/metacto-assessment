import Link from "next/link";
import { Notice, PageHead, TicketStatus, param, type SearchParams } from "@/components/ui";
import { TicketMove } from "@/components/ticket-move";
import { ReworkCallout } from "@/components/rework-callout";
import { engineers, feedbackTargets, listProjects, listTickets } from "@/domain/delivery";
import { requireActor } from "@/domain/session";
import { reworkRequests } from "@/domain/validation";
import { statusesFor } from "@/domain/workflow";
import { boardColumns } from "@/components/board-columns";
import { moveMyTicketAction } from "../actions";

export const dynamic = "force-dynamic";

// My Work: one place for delivery, as a lightweight board or a dense backlog table.
export default async function MyWorkPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireActor(["engineer"]);
  const sp = await searchParams;
  const view = param(sp.view) === "backlog" ? "backlog" : "board";
  const assignee = sp.assignee === undefined ? actor.id : param(sp.assignee); // default: me; "" = everyone
  const filters = { q: param(sp.q), projectId: param(sp.project), accountId: param(sp.client), priority: param(sp.priority), assigneeId: assignee };
  const [tickets, projects, clients, people, reworks] = await Promise.all([listTickets(actor, filters), listProjects(actor), feedbackTargets(actor), engineers(), reworkRequests(actor, { openOnly: true })]);
  const workflows = await statusesFor(projects.map((p) => p.id));
  // One project selected: its own status columns. Otherwise: the four stages.
  const columns = boardColumns(tickets, filters.projectId ? workflows.get(filters.projectId) ?? null : null);
  // Keep the current filters when switching Board/Backlog or returning from an action.
  const qs = (v: string) => {
    const p = new URLSearchParams();
    for (const [k, val] of Object.entries(sp)) if (typeof val === "string" && !["notice", "error", "view"].includes(k)) p.set(k, val);
    p.set("view", v);
    return `?${p}`;
  };
  const back = `/engineer/work${qs(view)}`;

  return (
    <>
      <PageHead eyebrow="My work" title="Delivery tickets" lede="Tickets are what we're building. Each one links to the Customer Need that explains why.">
        <div className="segmented" role="group" aria-label="Layout">
          <Link href={qs("board")} className="btn btn-sm" style={view === "board" ? { background: "var(--ink)", color: "var(--cloud)" } : undefined} aria-current={view === "board" ? "true" : undefined}>Board</Link>
          <Link href={qs("backlog")} className="btn btn-sm" style={view === "backlog" ? { background: "var(--ink)", color: "var(--cloud)" } : undefined} aria-current={view === "backlog" ? "true" : undefined}>Backlog</Link>
        </div>
      </PageHead>
      <Notice notice={param(sp.notice)} error={param(sp.error)} />
      <ReworkCallout reworks={reworks} hrefFor={(id) => `/engineer/tickets/${id}`} />

      <form className="toolbar" role="search" aria-label="Filter tickets">
        <input type="hidden" name="view" value={view} />
        <label className="field grow">Search<input type="search" name="q" defaultValue={filters.q} placeholder="Ticket, project or client…" /></label>
        <label className="field">Project<select name="project" defaultValue={filters.projectId}><option value="">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="field">Client<select name="client" defaultValue={filters.accountId}><option value="">All clients</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="field">Priority<select name="priority" defaultValue={filters.priority}><option value="">All</option>{["P0", "P1", "P2", "P3"].map((p) => <option key={p}>{p}</option>)}</select></label>
        <label className="field">Assignee<select name="assignee" defaultValue={assignee}><option value={actor.id}>Me</option><option value="">Everyone</option>{people.filter((p) => p.id !== actor.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <button className="btn btn-ghost btn-sm" type="submit">Apply</button>
        <Link className="btn-link" href={`/engineer/work?view=${view}`}>Reset</Link>
      </form>
      <p className="muted" aria-live="polite" style={{ margin: "-.4rem 0 .9rem" }}>{tickets.length} ticket{tickets.length === 1 ? "" : "s"}</p>

      {view === "board" ? (
        <div className="board dyn" style={{ "--cols": columns.length } as React.CSSProperties}>
          {columns.map((col) => {
            const cards = col.cards;
            return (
              <section className="col" key={col.key} aria-label={col.title}>
                <div className="col-head"><h2>{col.title}</h2><span>{cards.length}</span></div>
                {cards.map((t) => (
                  <div className={`ticket${t.assigneeId === actor.id ? " mine" : ""}`} key={t.id}>
                    <span className="ticket-id">{t.key} · <span className="prio">{t.priority ?? "—"}</span> · Effort {t.effort ?? "—"}</span>
                    <span className="t-title"><Link className="row-link" href={`/engineer/tickets/${t.id}`}>{t.title}</Link></span>
                    <span className="muted">{t.projectName} · {t.accountName}</span>
                    <span className="meta">
                      {!filters.projectId && <TicketStatus name={t.statusName} stage={t.stage} />}
                      <span className="chip">{t.assignee ?? "Unassigned"}{t.assigneeId === actor.id ? " (you)" : ""}</span>
                    </span>
                    <div style={{ marginTop: ".55rem" }}>
                      <TicketMove actor={actor} ticket={t} statuses={workflows.get(t.projectId) ?? []} action={moveMyTicketAction.bind(null, t.id, back)} />
                    </div>
                  </div>
                ))}
                {!cards.length && <p className="muted" style={{ padding: ".3rem" }}>No tickets</p>}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="card flush">
          <table className="stack-sm">
            <thead><tr><th scope="col">Ticket</th><th scope="col">Project</th><th scope="col">Client</th><th scope="col">Priority</th><th scope="col">Effort</th><th scope="col">Assignee</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id}>
                  <td className="primary"><span className="ticket-id">{t.key}</span><br /><Link className="row-link" href={`/engineer/tickets/${t.id}`}>{t.title}</Link></td>
                  <td data-label="Project"><Link className="btn-link" href={`/engineer/projects/${t.projectId}`}>{t.projectName}</Link></td>
                  <td data-label="Client">{t.accountName}</td>
                  <td data-label="Priority" className="prio">{t.priority ?? "—"}</td>
                  <td data-label="Effort">{t.effort ?? "—"}</td>
                  <td data-label="Assignee">{t.assignee ?? "Unassigned"}</td>
                  <td data-label="Status"><TicketStatus name={t.statusName} stage={t.stage} /></td>
                </tr>
              ))}
              {!tickets.length && <tr><td colSpan={7} className="muted">No tickets match these filters. <Link href="/engineer/work?view=backlog&assignee=">Show everyone&apos;s tickets</Link></td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
