import Link from "next/link";
import type { ReworkView } from "@/domain/validation";

/** Open rework requests, so a customer's "something isn't right" is never missed. */
export function ReworkCallout({ reworks, hrefFor }: { reworks: ReworkView[]; hrefFor: (ticketId: string) => string }) {
  if (!reworks.length) return null;
  return (
    <div className="card section" role="status">
      <span className="strong">{reworks.length} rework {reworks.length === 1 ? "request needs" : "requests need"} review</span>
      <ul style={{ marginTop: ".4rem" }}>
        {reworks.map((r) => (
          <li key={r.id}><Link className="btn-link" href={hrefFor(r.ticketId)}>{r.ticketKey} {r.ticketTitle}</Link> <span className="muted">· {r.customer}, {r.accountName}: {r.context?.summary ?? r.description}</span></li>
        ))}
      </ul>
    </div>
  );
}
