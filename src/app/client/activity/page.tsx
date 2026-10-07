import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { NeedStatus, PageHead } from "@/components/ui";
import { EvidenceFiles } from "@/components/evidence-files";
import { attachmentsForRequests } from "@/domain/attachments";
import { PublicStatusChip } from "@/components/public-ticket";
import { customerActivity, customerTickets } from "@/domain/tracking";
import { getDb } from "@/db/client";
import { needs, requests, supports } from "@/db/schema";
import { requireActor } from "@/domain/session";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  const actor = await requireActor(["client"]);
  const db = getDb();
  const [mine, supported] = await Promise.all([
    db.select({ id: requests.id, title: requests.title, linkState: requests.linkState, needId: needs.id, needTitle: needs.title, needStatus: needs.status, rationale: needs.publicRationale })
      .from(requests).leftJoin(needs, eq(needs.id, requests.needId)).where(eq(requests.submittedBy, actor.id)).orderBy(desc(requests.createdAt)),
    db.select({ id: needs.id, title: needs.title, status: needs.status }).from(supports).innerJoin(needs, eq(needs.id, supports.needId))
      .where(eq(supports.userId, actor.id)).orderBy(desc(supports.createdAt)),
  ]);
  const [files, feed, delivery] = await Promise.all([attachmentsForRequests(mine.map((r) => r.id)), customerActivity(actor), customerTickets(actor)]);
  const linkedIds = new Set(mine.filter((r) => r.linkState === "confirmed").map((r) => r.needId));
  const onlySupported = supported.filter((s) => !linkedIds.has(s.id));

  return (
    <div className="narrow">
      <PageHead eyebrow="My activity" title="Your requests and supported needs" />
      {feed.length > 0 && (
        <section className="section" style={{ marginTop: 0, marginBottom: "1.5rem" }} aria-labelledby="recent-h">
          <div className="section-head"><h2 id="recent-h" style={{ fontSize: "1.05rem" }}>Recent updates</h2></div>
          <div className="card">
            <ol className="timeline">
              {feed.slice(0, 6).map((f, i) => (
                <li key={i} className={i === 0 ? "now" : "done"}>
                  <Link className="btn-link" href={f.href}>{f.text}</Link><br />
                  <span className="when">{f.at.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>
      )}
      {delivery.tickets.length > 0 && (
        <section style={{ marginBottom: "1.5rem" }} aria-labelledby="deliveries-h">
          <div className="section-head"><h2 id="deliveries-h" style={{ fontSize: "1.05rem" }}>Your deliveries</h2></div>
          <div className="card flush list">
            {delivery.tickets.map((t) => (
              <div className="item item-body" key={t.id}>
                <div><Link className="row-link" href={`/client/tickets/${t.id}`}>{t.title}</Link><p className="muted">{t.needTitle}</p></div>
                <PublicStatusChip status={t.publicStatus} />
              </div>
            ))}
          </div>
        </section>
      )}
      <div className="card flush list">
        {mine.map((r) => (
          <div className="item item-body" key={r.id}>
            <div>
              <p className="strong">"{r.title}"</p>
              {r.linkState === "confirmed" && r.needId ? (
                <p className="muted">Supporting <Link className="btn-link" href={`/client/needs/${r.needId}`}>{r.needTitle}</Link>
                  {r.needStatus === "not_planned" && r.rationale ? ` · ${r.rationale}` : ""}</p>
              ) : (
                <p className="muted">New request · waiting for product review</p>
              )}
              <EvidenceFiles files={files.get(r.id)} />
            </div>
            {r.linkState === "confirmed" && r.needStatus ? <NeedStatus status={r.needStatus} /> : <NeedStatus status="under_review" />}
          </div>
        ))}
        {onlySupported.map((s) => (
          <div className="item item-body" key={s.id}>
            <div><p className="strong">Supporting</p><p className="muted"><Link className="btn-link" href={`/client/needs/${s.id}`}>{s.title}</Link></p></div>
            <NeedStatus status={s.status} />
          </div>
        ))}
        {!mine.length && !onlySupported.length && (
          <div className="item muted">Nothing yet. <Link href="/client/share">Share feedback</Link> or <Link href="/client/discover">support an existing need</Link>.</div>
        )}
      </div>
    </div>
  );
}
