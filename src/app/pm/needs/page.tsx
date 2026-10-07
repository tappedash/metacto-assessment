import Link from "next/link";
import { Level, NeedStatus, PageHead, param, type SearchParams } from "@/components/ui";
import { listNeeds } from "@/domain/needs";

export const dynamic = "force-dynamic";

const money = (n: number) => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n ? `$${Math.round(n / 1000)}K` : "—");

export default async function NeedsPage({ searchParams }: { searchParams: SearchParams }) {
  const sort = param((await searchParams).sort) === "strategic" ? "strategic" : "demand";
  const rows = (await listNeeds()).sort((a, b) =>
    sort === "strategic"
      ? b.signals.strategicLevel - a.signals.strategicLevel || b.signals.contractValue - a.signals.contractValue
      : b.signals.demandLevel - a.signals.demandLevel || b.signals.supporters - a.signals.supporters,
  );
  return (
    <>
      <PageHead eyebrow="Customer Needs" title="Popular isn't the same as important"
        lede="Demand and Strategic Value are measured separately. Sort by either to see where they disagree.">
        <div className="segmented" role="group" aria-label="Sort by">
          <Link href="?sort=demand" className="btn btn-sm" aria-current={sort === "demand" ? "true" : undefined} style={sort === "demand" ? { background: "var(--ink)", color: "var(--cloud)" } : undefined}>Sort: Demand</Link>
          <Link href="?sort=strategic" className="btn btn-sm" aria-current={sort === "strategic" ? "true" : undefined} style={sort === "strategic" ? { background: "var(--ink)", color: "var(--cloud)" } : undefined}>Sort: Strategic Value</Link>
        </div>
      </PageHead>
      <div className="card flush">
        <table className="stack-sm">
          <thead>
            <tr>
              <th scope="col">Customer Need</th>
              <th scope="col" className="group-demand divider">Demand</th>
              <th scope="col" className="group-demand">Requests · Accounts</th>
              <th scope="col" className="group-strategic divider">Strategic Value</th>
              <th scope="col" className="group-strategic">Enterprise · Contract value</th>
              <th scope="col" className="divider">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((n) => (
              <tr key={n.id}>
                <td className="primary"><Link className="row-link" href={`/pm/needs/${n.id}`}>{n.title}</Link><br />
                  <span className="muted">{n.signals.supporters} supporters{n.signals.trendPct !== null ? ` · ${n.signals.trendPct >= 0 ? "↑" : "↓"} ${Math.abs(n.signals.trendPct)}% (30d)` : ""}</span></td>
                <td data-label="Demand" className="divider"><Level kind="demand" level={n.signals.demandLevel} /></td>
                <td data-label="Requests · Accounts">{n.signals.requests} · {n.signals.accounts}</td>
                <td data-label="Strategic Value" className="divider"><Level kind="strategic" level={n.signals.strategicLevel} /></td>
                <td data-label="Enterprise · Contract value">{n.signals.enterpriseAccounts} · {money(n.signals.contractValue)}</td>
                <td data-label="Status" className="divider"><NeedStatus status={n.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
