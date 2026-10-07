import { and, desc, eq, inArray, isNotNull, or } from "drizzle-orm";
import Link from "next/link";
import { NeedStatus, PageHead } from "@/components/ui";
import { getDb } from "@/db/client";
import { needs, projects, requests, statusUpdates, tickets } from "@/db/schema";
import { requireActor } from "@/domain/session";

export const dynamic = "force-dynamic";

// PM-approved updates for Needs that affect the engineer's staffed clients.
export default async function ApprovedUpdatesPage() {
  const actor = await requireActor(["engineer"]);
  const staffed = actor.staffedAccountIds ?? [];
  const db = getDb();
  const rows = staffed.length
    ? await db.selectDistinct({ id: statusUpdates.id, subject: statusUpdates.subject, body: statusUpdates.body, status: statusUpdates.status, sentAt: statusUpdates.sentAt, needId: needs.id, needTitle: needs.title })
      .from(statusUpdates)
      .innerJoin(needs, eq(needs.id, statusUpdates.needId))
      .leftJoin(requests, eq(requests.needId, needs.id))
      .leftJoin(tickets, eq(tickets.needId, needs.id))
      .leftJoin(projects, eq(projects.id, tickets.projectId))
      .where(and(isNotNull(statusUpdates.sentAt), or(inArray(requests.accountId, staffed), inArray(projects.accountId, staffed))))
      .orderBy(desc(statusUpdates.sentAt))
    : [];
  return (
    <div className="narrow">
      <PageHead eyebrow="Approved updates" title="Share what's official" lede="Forward PM-approved updates to your client contacts. Don't make roadmap promises outside these." />
      <div className="card flush list">
        {rows.map((u) => (
          <div className="item" key={u.id}>
            <div className="item-head"><NeedStatus status={u.status} /><span className="muted">{u.sentAt?.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span></div>
            <h2 style={{ font: "600 .98rem var(--font-sans)" }}>{u.subject}</h2>
            <p className="muted" style={{ whiteSpace: "pre-line", marginTop: ".3rem" }}>{u.body}</p>
            <p className="muted" style={{ marginTop: ".3rem" }}>Customer Need: <Link className="btn-link" href={`/engineer/needs/${u.needId}`}>{u.needTitle}</Link></p>
          </div>
        ))}
        {!rows.length && <div className="item muted">No approved updates for your clients yet.</div>}
      </div>
    </div>
  );
}
