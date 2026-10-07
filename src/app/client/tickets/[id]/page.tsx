import Link from "next/link";
import { notFound } from "next/navigation";
import { Back, Notice, param, type SearchParams } from "@/components/ui";
import { PublicProgress, PublicStatusChip } from "@/components/public-ticket";
import { requireActor } from "@/domain/session";
import { customerTicket, PUBLIC_STATUS, type PublicStatus } from "@/domain/tracking";
import { Validation } from "./validation";

export const dynamic = "force-dynamic";

const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

// Customer view of a delivery ticket: public status, progress and updates shared with them.
// No internal status names, estimates, assignees or internal notes.
export default async function ClientTicketPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const actor = await requireActor(["client"]);
  const { id } = await params;
  const sp = await searchParams;
  const data = await customerTicket(actor, id);
  if (!data) notFound();
  const { ticket, timeline, validations } = data;
  const reached = new Map<PublicStatus, Date>();
  for (const e of timeline) if (e.kind === "status" && e.publicStatus && !reached.has(e.publicStatus)) reached.set(e.publicStatus, e.createdAt);

  return (
    <div className="narrow">
      <Back href="/client/activity" label="My Activity" />
      <Notice notice={param(sp.notice)} error={param(sp.error)} />
      <div className="page-head">
        <div>
          <span className="eyebrow">Delivery</span>
          <h1>{ticket.title}</h1>
          <p className="lede">Part of <Link className="btn-link" href={`/client/needs/${ticket.needId}`}>{ticket.needTitle}</Link> · last updated {day(ticket.lastUpdated)}</p>
        </div>
        <PublicStatusChip status={ticket.publicStatus} />
      </div>

      <Validation ticket={ticket} validations={validations} />

      <div className="grid split">
        <div className="card">
          <h2 style={{ fontSize: "1.05rem", marginBottom: ".9rem" }}>Updates</h2>
          {timeline.length ? (
            <ol className="timeline">
              {[...timeline].reverse().map((e, i) => (
                <li key={e.id} className={i === 0 ? "now" : "done"}>
                  <span className="strong">
                    {e.kind === "status" && e.publicStatus ? `Moved to ${PUBLIC_STATUS[e.publicStatus].label}`
                      : e.kind === "validation" && e.authorRole === "client" ? `Feedback from ${e.author ?? "your team"}` : "Update from the team"}
                  </span>
                  <br /><span className="when">{day(e.createdAt)}{e.kind !== "status" && e.author && e.authorRole !== "client" ? ` · ${e.author}` : ""}</span>
                  {e.body && <p style={{ whiteSpace: "pre-line", marginTop: ".25rem" }}>{e.body}</p>}
                </li>
              ))}
            </ol>
          ) : <p className="muted">No updates yet. We&apos;ll post here as work progresses.</p>}
        </div>
        <div className="card">
          <h2 style={{ fontSize: "1.05rem", marginBottom: ".9rem" }}>Progress</h2>
          <PublicProgress status={ticket.publicStatus} reached={reached} />
        </div>
      </div>
    </div>
  );
}
