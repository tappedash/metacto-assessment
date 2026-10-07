import Link from "next/link";
import { NEED_STATUS, STAGE_CHIP } from "@/domain/labels";

export function NeedStatus({ status }: { status: string }) {
  const s = NEED_STATUS[status] ?? NEED_STATUS.under_review;
  return <span className={`chip ${s.chip}`}>{s.label}</span>;
}

/** A project's own status name, styled by its stage. */
export function TicketStatus({ name, stage }: { name: string; stage: string }) {
  return <span className={`chip ${STAGE_CHIP[stage] ?? STAGE_CHIP.backlog}`}>{name}</span>;
}

export function Back({ href, label }: { href: string; label: string }) {
  return (
    <Link className="back" href={href}>
      <span className="ico i-chevron-left" aria-hidden="true" />
      <span className="back-label">{label}</span>
    </Link>
  );
}

/** Flash message passed as ?notice= / ?error= after a server action redirect. */
export function Notice({ notice, error }: { notice?: string; error?: string }) {
  if (error) return <p className="notice err" role="alert">{error}</p>;
  if (notice) return <p className="notice ok" role="status">{notice}</p>;
  return null;
}

export function Level({ kind, level }: { kind: "demand" | "strategic"; level: number }) {
  const labels = ["Low", "Low", "Medium", "High", "Very high"];
  return (
    <span className={`level ${kind}`}>
      <span className="bars" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => <i key={i} className={i <= level ? "on" : undefined} />)}
      </span>
      {labels[level]}
    </span>
  );
}

export function PageHead({ eyebrow, title, lede, children }: { eyebrow: string; title: string; lede?: string; children?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {lede && <p className="lede">{lede}</p>}
      </div>
      {children}
    </div>
  );
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;
export const param = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
