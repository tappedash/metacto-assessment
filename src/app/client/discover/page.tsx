import Link from "next/link";
import { NeedStatus, PageHead, param, type SearchParams } from "@/components/ui";
import { listNeeds } from "@/domain/needs";
import { toPublicNeed } from "@/domain/permissions";

export const dynamic = "force-dynamic";

export default async function DiscoverPage({ searchParams }: { searchParams: SearchParams }) {
  const q = param((await searchParams).q).toLowerCase();
  const needs = (await listNeeds())
    .map((n) => toPublicNeed(n, n.signals.supporters))
    .filter((n) => !q || `${n.title} ${n.problemStatement}`.toLowerCase().includes(q))
    .sort((a, b) => b.supporterCount - a.supporterCount);
  return (
    <div className="narrow">
      <PageHead eyebrow="Discover" title="Needs others have raised" lede="Support an existing need instead of starting a new one." />
      <form role="search" style={{ marginBottom: "1rem" }}>
        <label className="field" style={{ margin: 0 }}><span className="sr-only">Search needs</span>
          <input type="search" name="q" defaultValue={q} placeholder="Search needs…" />
        </label>
      </form>
      <div className="card flush list">
        {needs.map((n) => (
          <div className="item item-body" key={n.id}>
            <div>
              <Link className="row-link" href={`/client/needs/${n.id}`}>{n.title}</Link>
              <p className="muted">{n.problemStatement} · {n.supporterCount} supporters</p>
            </div>
            <NeedStatus status={n.status} />
          </div>
        ))}
        {!needs.length && <div className="item muted">No needs match "{q}". <Link href="/client/share">Share it as new feedback</Link>.</div>}
      </div>
    </div>
  );
}
