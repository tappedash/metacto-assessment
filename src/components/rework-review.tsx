import type { ReworkView } from "@/domain/validation";

const when = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const STATE = {
  open: { label: "Needs review", chip: "st-review" },
  reopened: { label: "Reopened", chip: "st-dev" },
  declined: { label: "Not reopened", chip: "st-notplanned" },
} as const;

// A customer said a released ticket isn't right. The PM or a staffed engineer reads what AI
// understood (confirmed by the customer) and decides: reopen the work, or explain why not.
export function ReworkReview({ reworks, action }: { reworks: ReworkView[]; action: (validationId: string, form: FormData) => Promise<void> }) {
  if (!reworks.length) return null;
  return (
    <section className="section stack" aria-label="Rework requests">
      {reworks.map((r) => (
        <div className="card" key={r.id}>
          <div className="item-head" style={{ justifyContent: "space-between" }}>
            <span className="strong">Rework request · {r.customer}, {r.accountName} · {when(r.createdAt)}</span>
            <span className={`chip ${STATE[r.state].chip}`}>{STATE[r.state].label}</span>
          </div>
          {r.context && (
            <div className="ai-panel" style={{ marginTop: ".6rem" }}>
              <span className="ai-tag">AI understood · confirmed by the customer</span>
              <p style={{ marginTop: ".35rem" }}>{r.context.summary}</p>
              <dl className="meta-grid" style={{ marginTop: ".5rem" }}>
                {r.context.expected && <div><dt>Expected</dt><dd>{r.context.expected}</dd></div>}
                {r.context.actual && <div><dt>What happens</dt><dd>{r.context.actual}</dd></div>}
                {r.context.impact && <div><dt>Impact</dt><dd>{r.context.impact}</dd></div>}
              </dl>
            </div>
          )}
          {r.description && <p className="muted" style={{ marginTop: ".6rem", whiteSpace: "pre-line" }}>In their words: “{r.description}”</p>}
          {r.attachments.length > 0 && (
            <p style={{ marginTop: ".5rem" }}>Files: {r.attachments.map((a, i) => (
              <span key={a.id}>{i > 0 && ", "}<a className="btn-link" href={a.href} target="_blank" rel="noreferrer">{a.filename}</a></span>
            ))}</p>
          )}
          {r.state === "open" ? (
            <form action={action.bind(null, r.id)} style={{ marginTop: ".9rem" }}>
              <label className="field">Note to the customer <span className="hint">(required to decline; shown to them)</span>
                <textarea name="note" maxLength={2000} placeholder="e.g. Confirmed: existing lanes are duplicated. We're fixing the import to update them." />
              </label>
              <div className="btn-row">
                <button className="btn btn-primary btn-sm" name="decision" value="reopen" type="submit">Reopen ticket</button>
                <button className="btn btn-ghost btn-sm" name="decision" value="decline" type="submit">Don&apos;t reopen</button>
              </div>
              <p className="muted" style={{ marginTop: ".4rem" }}>Reopening moves the ticket back to In Development, and the customer sees it there.</p>
            </form>
          ) : r.resolutionNote && <p style={{ marginTop: ".6rem" }}><span className="strong">Note sent:</span> {r.resolutionNote}</p>}
        </div>
      ))}
    </section>
  );
}
