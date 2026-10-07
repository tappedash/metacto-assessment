import Link from "next/link";
import { NeedStatus, Notice, PageHead, param, type SearchParams } from "@/components/ui";
import { listUpdates, recipientSummary } from "@/domain/decisions";
import { approveUpdateAction } from "../actions";
import { SubmitButton } from "@/components/submit-button";

export const dynamic = "force-dynamic";

// Nothing reaches customers until the PM approves the AI draft.
export default async function UpdatesPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { drafts, sent } = await listUpdates();
  const recipients = await Promise.all(drafts.map((d) => recipientSummary(d.needId)));
  return (
    <>
      <PageHead eyebrow="Updates" title="Nothing goes out without your approval" lede="AI drafts an update on every status change. Edit it, then send." />
      <Notice notice={param(sp.notice)} error={param(sp.error)} />
      <div className="grid split">
        <div className="stack">
          {drafts.map((d, i) => (
            <form className="card" key={d.id} action={approveUpdateAction.bind(null, d.id)}>
              <div className="section-head">
                <span className="ai-tag">Drafted update</span>
                <span className="muted"><Link className="btn-link" href={`/pm/needs/${d.needId}`}>{d.needTitle}</Link> → <NeedStatus status={d.status} /></span>
              </div>
              <label className="field">Subject<input type="text" name="subject" defaultValue={d.subject} required /></label>
              <label className="field">Message<textarea name="body" defaultValue={d.body} style={{ minHeight: 150 }} required /></label>
              <p className="muted" style={{ marginBottom: ".8rem" }}>Goes to {recipients[i].customers} requesters & supporters and {recipients[i].engineers} engineers on affected clients.</p>
              <SubmitButton pending="Sending…">Approve &amp; send</SubmitButton>
            </form>
          ))}
          {!drafts.length && <div className="card empty"><h2>No drafts waiting</h2><p className="muted">Save a decision on a Customer Need and AI will draft the update here.</p></div>}
        </div>
        <div className="card">
          <h2 style={{ fontSize: "1.05rem", marginBottom: ".8rem" }}>Recently sent</h2>
          <ol className="timeline">
            {sent.slice(0, 8).map((u) => (
              <li className="done" key={u.id}><span className="strong">{u.subject}</span><br /><span className="when">{u.needTitle} · {u.sentAt?.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span></li>
            ))}
          </ol>
          {!sent.length && <p className="muted">Nothing sent yet.</p>}
          <p className="muted" style={{ marginTop: "1rem" }}>Customers see the public rationale and this message, never scores, contract values or internal notes. Local emails land in <a href="http://localhost:8025" target="_blank" rel="noreferrer">Mailpit</a>.</p>
        </div>
      </div>
    </>
  );
}
