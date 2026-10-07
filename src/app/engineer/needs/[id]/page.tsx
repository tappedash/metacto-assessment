import Link from "next/link";
import { notFound } from "next/navigation";
import { Back, NeedStatus, TicketStatus } from "@/components/ui";
import { getNeed, needEvidence, needSignals, needTickets } from "@/domain/needs";
import { canViewAccountEvidence } from "@/domain/permissions";
import { requireActor } from "@/domain/session";

export const dynamic = "force-dynamic";

// Engineer view of a Customer Need: evidence only from staffed clients, others as counts.
// No contract value, no rubric.
export default async function EngineerNeedPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor(["engineer"]);
  const { id } = await params;
  const need = await getNeed(id);
  if (!need) notFound();
  const [evidence, signals, tickets] = await Promise.all([needEvidence(id, actor), needSignals([id]), needTickets(id)]);
  const s = signals.get(id)!;
  const visibleTickets = tickets.filter((t) => canViewAccountEvidence(actor, t.accountId));
  const hiddenTickets = tickets.length - visibleTickets.length;

  return (
    <>
      <Back href="/engineer/work" label="My Work" />
      <div className="page-head">
        <div><span className="eyebrow">Customer Need</span><h1>{need.title}</h1><p className="lede">{need.problemStatement}</p></div>
        <NeedStatus status={need.status} />
      </div>
      <p className="notice"><b className="strong">Demand</b> {s.requests} Feature Requests · {s.supporters} supporters · {s.accounts} accounts</p>

      <div className="grid split">
        <div>
          <div className="section-head"><h2>Customer evidence</h2><span className="muted">{evidence.visible.length} from your clients</span></div>
          <div className="card flush list">
            {evidence.visible.map((e) => (
              <div className="item" key={e.id}>
                <p className="muted">{e.label} · {e.accountName} · {e.submittedBy === actor.name ? "logged by you" : e.onBehalf ? `logged by ${e.submittedBy}` : "client"}</p>
                <p className="quote">"{e.title}"{e.why ? ` ${e.why}` : ""}</p>
              </div>
            ))}
            {evidence.hiddenCount > 0 && (
              <div className="item"><p className="muted">+{evidence.hiddenCount} Feature Request{evidence.hiddenCount === 1 ? "" : "s"} from {evidence.hiddenAccounts} other account{evidence.hiddenAccounts === 1 ? "" : "s"} · details hidden (not on your engagements)</p></div>
            )}
            {!evidence.all.length && <div className="item muted">No confirmed evidence yet.</div>}
          </div>
        </div>
        <div>
          <div className="section-head"><h2>Delivery</h2></div>
          <div className="card flush list">
            {visibleTickets.map((t) => (
              <div className="item item-body" key={t.id}>
                <div><span className="ticket-id">{t.key}</span><br /><Link className="row-link" href={`/engineer/tickets/${t.id}`}>{t.title}</Link>
                  <p className="muted"><Link className="btn-link" href={`/engineer/projects/${t.projectId}`}>{t.projectName}</Link> · {t.accountName}</p></div>
                <TicketStatus status={t.status} />
              </div>
            ))}
            {hiddenTickets > 0 && <div className="item muted">+{hiddenTickets} ticket{hiddenTickets === 1 ? "" : "s"} on other engagements</div>}
            {!tickets.length && <div className="item muted">No delivery tickets yet.</div>}
          </div>
          <p className="muted" style={{ marginTop: ".6rem" }}>Ticket counts don&apos;t measure demand. Demand comes from Feature Requests, supporters and accounts.</p>
        </div>
      </div>
    </>
  );
}
