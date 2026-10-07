import { PUBLIC_STATUS } from "@/domain/tracking";

interface TeamEvent {
  id: string;
  kind: "status" | "comment" | "validation";
  visibility: "internal" | "customer";
  body: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  publicStatus: keyof typeof PUBLIC_STATUS | null;
  author: string | null;
  createdAt: Date;
}

const when = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** Team timeline: every status move and comment, labelled with who can see it. */
export function TeamTimeline({ events }: { events: TeamEvent[] }) {
  if (!events.length) return <p className="muted">No updates yet.</p>;
  return (
    <ol className="timeline">
      {events.map((e, i) => (
        <li key={e.id} className={i === 0 ? "now" : "done"}>
          <span className="strong">
            {e.kind === "status" ? `${e.fromStatus} → ${e.toStatus}` : e.kind === "validation" ? "Customer validation" : "Update"}
          </span>{" "}
          <span className={`chip ${e.visibility === "customer" ? "st-planned" : "st-review"}`} style={{ fontSize: 11 }}>
            {e.visibility === "customer" ? "Customer visible" : "Internal only"}
          </span>
          <br />
          <span className="when">{when(e.createdAt)}{e.author ? ` · ${e.author}` : ""}</span>
          {e.kind === "status" && e.visibility === "customer" && e.publicStatus && <><br /><span className="muted">Customers see: {PUBLIC_STATUS[e.publicStatus].label}</span></>}
          {e.body && <p style={{ whiteSpace: "pre-line", marginTop: ".25rem" }}>{e.body}</p>}
        </li>
      ))}
    </ol>
  );
}

/** Comment box for PMs and engineers; visibility defaults to internal. */
export function CommentForm({ action }: { action: (form: FormData) => Promise<void> }) {
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
      <p className="muted" style={{ fontSize: 12 }}>Never share estimates, debugging or security details, or anything about other customers, in a customer-visible update.</p>
      <div><button className="btn btn-dark btn-sm" type="submit">Post update</button></div>
    </form>
  );
}
