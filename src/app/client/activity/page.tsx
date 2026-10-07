import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { NeedStatus, PageHead } from "@/components/ui";
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
  const linkedIds = new Set(mine.filter((r) => r.linkState === "confirmed").map((r) => r.needId));
  const onlySupported = supported.filter((s) => !linkedIds.has(s.id));

  return (
    <div className="narrow">
      <PageHead eyebrow="My activity" title="Your requests and supported needs" />
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
