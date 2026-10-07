import { PUBLIC_STATUS } from "@/domain/tracking";

interface TeamEvent {
  id: string;
  kind: "status" | "comment" | "validation";
  visibility: "internal" | "customer";
  body: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  publicStatus: keyof typeof PUBLIC_STATUS | null;
  publishedAt: Date | null;
  author: string | null;
  createdAt: Date;
}

const when = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/**
 * Team timeline: every status move and comment, labelled with who can see it. Customer-visible
 * updates awaiting approval are flagged; the PM gets a Publish button (`publish`).
 */
export function TeamTimeline({ events, publish }: { events: TeamEvent[]; publish?: (eventId: string) => Promise<void> }) {
  if (!events.length) return <p className="muted">No updates yet.</p>;
  return (
    <ol className="timeline">
      {events.map((e, i) => (
        <li key={e.id} className={i === 0 ? "now" : "done"}>
          <span className="strong">
            {e.kind === "status" ? `${e.fromStatus} → ${e.toStatus}` : e.kind === "validation" ? "Customer validation" : "Update"}
          </span>{" "}
          {e.visibility === "customer" && !e.publishedAt
            ? <span className="chip st-review" style={{ fontSize: 11 }}>Customer visible · awaiting PM approval</span>
            : <span className={`chip ${e.visibility === "customer" ? "st-planned" : "st-review"}`} style={{ fontSize: 11 }}>
              {e.visibility === "customer" ? "Customer visible" : "Internal only"}
            </span>}
          <br />
          <span className="when">{when(e.createdAt)}{e.author ? ` · ${e.author}` : ""}</span>
          {e.kind === "status" && e.visibility === "customer" && e.publicStatus && <><br /><span className="muted">Customers see: {PUBLIC_STATUS[e.publicStatus].label}</span></>}
          {e.body && <p style={{ whiteSpace: "pre-line", marginTop: ".25rem" }}>{e.body}</p>}
          {publish && e.visibility === "customer" && !e.publishedAt && (
            <form action={publish.bind(null, e.id)} style={{ marginTop: ".4rem" }}>
              <button className="btn btn-primary btn-sm" type="submit">Publish to customers</button>
            </form>
          )}
        </li>
      ))}
    </ol>
  );
}

/** Comment box for PMs and engineers; visibility defaults to internal. */
export function CommentForm({ action, needsApproval = false }: { action: (form: FormData) => Promise<void>; needsApproval?: boolean }) {
  return (
    <form action={action} className="stack">
      <label className="field" style={{ margin: 0 }}>Add an update
        <textarea name="body" required maxLength={2000} placeholder="What changed? Customer-visible updates should be written for the customer." />
      </label>
      <fieldset className="segmented">
        <legend>Who can see this update</legend>
        <span><input type="radio" name="visibility" id="vis-internal" value="internal" defaultChecked /><label htmlFor="vis-internal">Internal only</label></span>
        <span><input type="radio" name="visibility" id="vis-customer" value="customer" /><label htmlFor="vis-customer">Customer visible</label></span>
      </fieldset>
      <p className="muted" style={{ fontSize: 12 }}>
        {needsApproval && "Customer-visible updates reach customers after the PM approves them. "}
        Never share estimates, debugging or security details, or anything about other customers, in a customer-visible update.
      </p>
      <div><button className="btn btn-dark btn-sm" type="submit">Post update</button></div>
    </form>
  );
}

/** Engineers ask the PM for a decision without leaving the ticket. */
export function PmInputForm({ action }: { action: (form: FormData) => Promise<void> }) {
  return (
    <form action={action} className="stack">
      <label className="field" style={{ margin: 0 }}>Need a product decision?
        <textarea name="question" required maxLength={2000} placeholder="e.g. Should the export include archived shipments?" />
      </label>
      <div><button className="btn btn-ghost btn-sm" type="submit">Ask the PM</button></div>
    </form>
  );
}
