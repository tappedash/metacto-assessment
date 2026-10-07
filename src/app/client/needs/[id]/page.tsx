import { notFound } from "next/navigation";
import { Back, NeedStatus, Notice, param, type SearchParams } from "@/components/ui";
import { NEED_STATUS } from "@/domain/labels";
import { getNeed, isSupporting, needSignals, sentUpdates } from "@/domain/needs";
import { toPublicNeed } from "@/domain/permissions";
import { requireActor } from "@/domain/session";
import { toggleSupport } from "../../actions";
import Link from "next/link";
import { PublicStatusChip } from "@/components/public-ticket";
import { customerTickets } from "@/domain/tracking";

export const dynamic = "force-dynamic";

const STAGES = ["under_review", "planned", "in_development", "released"] as const;

// Public fields only: problem statement, status, public rationale, supporters, approved updates.
export default async function ClientNeedPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const actor = await requireActor(["client"]);
  const { id } = await params;
  const sp = await searchParams;
  const record = await getNeed(id);
  if (!record) notFound();
  const signals = (await needSignals([id])).get(id)!;
  const need = toPublicNeed(record, signals.supporters);
  const [supporting, updates, delivery] = await Promise.all([isSupporting(actor.id, id), sentUpdates(id), customerTickets(actor, { needId: id })]);
  const otherProjects = delivery.otherProjects.get(id) ?? 0;
  const latest = updates[0];
  const stageIndex = STAGES.indexOf(need.status as (typeof STAGES)[number]);
  const reached = new Map(updates.map((u) => [u.status, u.sentAt!]));

  return (
    <div className="narrow">
      <Back href="/client/activity" label="My Activity" />
      <Notice notice={param(sp.notice)} error={param(sp.error)} />
      <div className="page-head">
        <div>
          <span className="eyebrow">Customer Need</span>
          <h1>{need.title}</h1>
          <p className="lede">{need.problemStatement}</p>
        </div>
        <NeedStatus status={need.status} />
      </div>

      <div className="notice">
        <span><b className="strong">{need.supporterCount}</b> supporters</span>
        {supporting && <span className="muted">· you support this need</span>}
        <span style={{ flex: 1 }} />
        <form action={toggleSupport.bind(null, id, !supporting)} className="inline-form">
          <button className={`btn btn-sm ${supporting ? "btn-ghost" : "btn-primary"}`} type="submit" aria-pressed={supporting}>
            {supporting ? "Supporting · remove" : "Support this need"}
          </button>
        </form>
      </div>

      {(delivery.tickets.length > 0 || otherProjects > 0) && (
        <section className="section" aria-labelledby="delivery-h" style={{ marginTop: 0, marginBottom: "1.25rem" }}>
          <div className="section-head"><h2 id="delivery-h" style={{ fontSize: "1.05rem" }}>Delivery</h2><span className="muted">What&apos;s being built for this</span></div>
          <div className="card flush list">
            {delivery.tickets.map((t) => (
              <div className="item item-body" key={t.id}>
                <div><Link className="row-link" href={`/client/tickets/${t.id}`}>{t.title}</Link>
                  <p className="muted">Updated {t.lastUpdated.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</p></div>
                <PublicStatusChip status={t.publicStatus} />
              </div>
            ))}
            {otherProjects > 0 && <div className="item muted">Also being delivered for {otherProjects} other {otherProjects === 1 ? "project" : "projects"}.</div>}
          </div>
        </section>
      )}

      <div className="grid split">
        <div className="card stack">
          {latest ? (
            <>
              <span className="eyebrow">Latest update · {latest.sentAt!.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
              <h2>{latest.subject}</h2>
              <p style={{ whiteSpace: "pre-line" }}>{latest.body}</p>
            </>
          ) : (
            <p className="muted">No updates yet. We'll email you when the status changes.</p>
          )}
          {need.publicRationale && <p className="muted"><b className="strong">Why we decided this:</b> {need.publicRationale}</p>}
        </div>
        <div className="card">
          <h2 style={{ fontSize: "1.05rem", marginBottom: ".9rem" }}>Progress</h2>
          {need.status === "not_planned" ? (
            <p className="muted">Not planned for now.</p>
          ) : (
            <ol className="timeline">
              {STAGES.map((s, i) => (
                <li key={s} className={i < stageIndex ? "done" : i === stageIndex ? "now" : undefined}>
                  <span className="strong">{NEED_STATUS[s].label}</span>{i === stageIndex && <span className="sr-only"> (current)</span>}
                  {reached.get(s) && <><br /><span className="when">{reached.get(s)!.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span></>}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
