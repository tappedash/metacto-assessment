import Link from "next/link";
import { asc } from "drizzle-orm";
import { Notice, PageHead, param, type SearchParams } from "@/components/ui";
import { getDb } from "@/db/client";
import { needs } from "@/db/schema";
import { autoMatchedCount, listTriage } from "@/domain/triage";
import { acceptTriageAction, createNeedAction, moveTriageAction } from "../actions";
import { SubmitButton } from "@/components/submit-button";

export const dynamic = "force-dynamic";

const REL: Record<string, { label: string; cls: string }> = {
  same: { label: "Same", cls: "rel-same" },
  related: { label: "Related", cls: "rel-related" },
  new: { label: "New", cls: "rel-new" },
};

// Exception inbox: only what AI could not settle. Confirmed matches never land here.
export default async function TriagePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const [items, autoMatched, allNeeds] = await Promise.all([
    listTriage(),
    autoMatchedCount(),
    getDb().select({ id: needs.id, title: needs.title }).from(needs).orderBy(asc(needs.title)),
  ]);
  return (
    <>
      <PageHead eyebrow="Triage" title={items.length ? `${items.length} item${items.length === 1 ? " needs" : "s need"} your judgment` : "All caught up"}
        lede="AI handled the obvious cases. These are matches it wasn't sure about, requests customers said are different, and proposed new Customer Needs." />
      <Notice notice={param(sp.notice)} error={param(sp.error)} />
      {autoMatched > 0 && (
        <p className="ai-panel" style={{ marginBottom: "1rem" }}>
          <span className="ai-tag">Handled by AI</span>{" "}
          <b>{autoMatched} request{autoMatched === 1 ? "" : "s"}</b> in the last 30 days matched an existing Customer Need with high confidence and the customer confirmed it. They were added as evidence without you. <Link className="btn-link" href="/pm/needs">See Customer Needs</Link>
        </p>
      )}
      {items.length === 0 ? (
        <div className="card empty">
          <h2>All caught up</h2>
          <p className="muted">New uncertain matches will appear here. Everything else is attached automatically.</p>
          <Link className="btn btn-ghost btn-sm" href="/pm/needs" style={{ marginTop: ".8rem" }}>Review Customer Needs</Link>
        </div>
      ) : (
        <div className="card flush list">
          {items.map((it) => {
            const rel = REL[it.linkType ?? "new"] ?? REL.new;
            return (
              <article className="item" key={it.id} aria-label={`Feature Request: ${it.title}`}>
                <div className="item-head">
                  <span className={`rel ${rel.cls}`}>{it.suggestedNeedId ? rel.label : "New"}</span>
                  {it.confidence != null && <span className="ai-tag">{Math.round(it.confidence * 100)}% confidence</span>}
                  <span className="muted">· {it.accountName} · {it.accountTier} · {it.onBehalf ? `logged by engineer ${it.submittedBy}` : it.submittedBy}{it.projectName ? ` · ${it.projectName}` : ""}</span>
                </div>
                <div className="item-body">
                  <div>
                    <p className="quote">"{it.title}"</p>
                    {it.why && <p className="muted">Why: {it.why}</p>}
                    {it.reason && <p className="muted" style={{ marginTop: ".35rem" }}>{it.reason}</p>}
                    {it.suggestedNeedId && (
                      <p className="proposal"><span className="ai-tag">Suggested Customer Need</span>{" "}
                        <Link className="btn-link" href={`/pm/needs/${it.suggestedNeedId}`}>{it.suggestedNeedTitle}</Link></p>
                    )}
                  </div>
                  <div className="actions">
                    {it.suggestedNeedId && (
                      <form action={acceptTriageAction.bind(null, it.id)}><SubmitButton className="btn btn-dark btn-sm" style={{ width: "100%" }} pending="Adding…">Accept</SubmitButton></form>
                    )}
                    <form action={createNeedAction.bind(null, it.id)}><SubmitButton className={`btn btn-sm ${it.suggestedNeedId ? "btn-ghost" : "btn-dark"}`} style={{ width: "100%" }} pending="AI is drafting…">Create new Need</SubmitButton></form>
                    <form action={moveTriageAction.bind(null, it.id)} className="stack">
                      <label className="sr-only" htmlFor={`move-${it.id}`}>Move to Customer Need</label>
                      <select id={`move-${it.id}`} name="needId" required style={{ marginTop: 0 }}>
                        {allNeeds.map((n) => <option key={n.id} value={n.id}>{n.title}</option>)}
                      </select>
                      <button className="btn btn-ghost btn-sm" type="submit">Move</button>
                    </form>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
