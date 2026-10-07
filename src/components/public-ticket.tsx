import { PUBLIC_ORDER, PUBLIC_STATUS, type PublicStatus } from "@/domain/tracking";

const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export function PublicStatusChip({ status }: { status: PublicStatus }) {
  return <span className={`chip ${PUBLIC_STATUS[status].chip}`}>{PUBLIC_STATUS[status].label}</span>;
}

/** Planned → In Development → Ready for Review → Released, with the date each was reached. */
export function PublicProgress({ status, reached }: { status: PublicStatus; reached: Map<PublicStatus, Date> }) {
  const current = PUBLIC_ORDER.indexOf(status);
  return (
    <ol className="timeline">
      {PUBLIC_ORDER.map((s, i) => (
        <li key={s} className={i < current ? "done" : i === current ? "now" : undefined}>
          <span className="strong">{PUBLIC_STATUS[s].label}</span>{i === current && <span className="sr-only"> (current)</span>}
          {reached.get(s) && i <= current && <><br /><span className="when">{day(reached.get(s)!)}</span></>}
        </li>
      ))}
    </ol>
  );
}
