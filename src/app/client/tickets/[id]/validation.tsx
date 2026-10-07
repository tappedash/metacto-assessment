import type { ticketValidations } from "@/db/schema";
import type { CustomerTicket } from "@/domain/tracking";
import { looksGoodAction } from "../../actions";
import { ReworkFlow } from "./rework-flow";

type ValidationRow = typeof ticketValidations.$inferSelect;

const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const REWORK_STATE = {
  open: { label: "Under review", chip: "st-review", text: "The team is reviewing what you reported. You'll see their decision here." },
  reopened: { label: "Reopened", chip: "st-dev", text: "The team reopened this to fix what you reported." },
  declined: { label: "Not reopened", chip: "st-notplanned", text: "The team looked into it and isn't reopening this." },
} as const;

// After release, the customer confirms it works or reports what isn't right. They never change
// the ticket's status: a rework request goes to the PM and engineers, who decide.
export function Validation({ ticket, validations }: { ticket: CustomerTicket; validations: ValidationRow[] }) {
  const confirmed = validations.find((v) => v.verdict === "looks_good");
  const reworks = validations.filter((v) => v.verdict === "rework");
  const open = reworks.some((v) => v.state === "open");
  const ask = ticket.publicStatus === "released" && !confirmed && !open;

  return (
    <>
      {reworks.map((v) => {
        const st = REWORK_STATE[v.state ?? "open"];
        const summary = (v.aiContext as { summary?: string } | null)?.summary || v.description;
        return (
          <div className="card section" key={v.id} role="status">
            <div className="item-head" style={{ justifyContent: "space-between" }}>
              <span className="strong">You reported something isn&apos;t right · {day(v.createdAt)}</span>
              <span className={`chip ${st.chip}`}>{st.label}</span>
            </div>
            {summary && <p className="muted" style={{ marginTop: ".35rem" }}>{summary}</p>}
            <p style={{ marginTop: ".5rem" }}>{v.resolutionNote ?? st.text}</p>
          </div>
        );
      })}
      {confirmed && (
        <div className="card section" role="status">
          <span className="strong">You confirmed this looks good · {day(confirmed.createdAt)}</span>
        </div>
      )}
      {ask && (
        <div className="card section">
          <h2 style={{ fontSize: "1.05rem" }}>This is released. Does it work for you?</h2>
          <p className="muted" style={{ margin: ".35rem 0 1rem" }}>Try it in your workflow, then let the team know.</p>
          <ReworkFlow ticketId={ticket.id} looksGood={looksGoodAction.bind(null, ticket.id)} />
        </div>
      )}
    </>
  );
}
