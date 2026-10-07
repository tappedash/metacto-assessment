import Link from "next/link";
import { Notice, PageHead, param, type SearchParams } from "@/components/ui";
import { listTickets } from "@/domain/delivery";
import { TICKET_ORDER, TICKET_STATUS } from "@/domain/labels";
import { requireActor } from "@/domain/session";
import { moveTicketAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function PmTicketsPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireActor(["pm"]);
  const sp = await searchParams;
  const tickets = await listTickets(actor);
  return (
    <>
      <PageHead eyebrow="Tickets" title="Delivery across projects"
        lede="Tickets are what Engineering is building; each links to the Customer Need that explains why. You move tickets into Planned; engineers move them through delivery." />
      <Notice notice={param(sp.notice)} error={param(sp.error)} />
      <div className="board four">
        {TICKET_ORDER.map((status) => {
          const cards = tickets.filter((t) => t.status === status);
          return (
            <section className="col" key={status} aria-label={TICKET_STATUS[status].label}>
              <div className="col-head"><h2>{TICKET_STATUS[status].label}</h2><span>{cards.length}</span></div>
              {cards.map((t) => (
                <div className="ticket" key={t.id}>
                  <span className="ticket-id">{t.key} · <span className="prio">{t.priority ?? "—"}</span> · Effort {t.effort ?? "—"}</span>
                  <span className="t-title">{t.title}</span>
                  <span className="muted">{t.projectName} · {t.accountName}</span><br />
                  <span className="muted">Customer Need: <Link className="btn-link" href={`/pm/needs/${t.needId}`}>{t.needTitle}</Link></span>
                  <span className="meta"><span className="chip">{t.assignee ?? "Unassigned"}</span></span>
                  {status === "backlog" && (
                    <form action={moveTicketAction.bind(null, t.id, "planned", "/pm/tickets")} style={{ marginTop: ".55rem" }}>
                      <button className="btn btn-dark btn-sm" type="submit">Plan</button>
                    </form>
                  )}
                </div>
              ))}
              {!cards.length && <p className="muted" style={{ padding: ".3rem" }}>No tickets</p>}
            </section>
          );
        })}
      </div>
    </>
  );
}
