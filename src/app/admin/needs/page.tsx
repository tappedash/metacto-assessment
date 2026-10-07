import { Level, NeedStatus, PageHead } from "@/components/ui";
import { listNeeds } from "@/domain/needs";

export const dynamic = "force-dynamic";

const money = (n: number) => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n ? `$${Math.round(n / 1000)}K` : "—");

// Read-only: triage, prioritization and roadmap decisions belong to the Product Manager.
export default async function AdminNeedsPage() {
  const rows = await listNeeds();
  return (
    <>
      <PageHead eyebrow="Customer Needs · read-only" title="What clients need, and what Product decided" lede="Triage, prioritization and roadmap decisions belong to the Product Manager." />
      <div className="card flush">
        <table className="stack-sm">
          <thead><tr><th scope="col">Customer Need</th><th scope="col" className="group-demand">Demand</th><th scope="col" className="group-strategic">Strategic Value</th><th scope="col">Priority</th><th scope="col">Status</th><th scope="col">Rationale</th></tr></thead>
          <tbody>
            {rows.map((n) => (
              <tr key={n.id}>
                <td className="primary"><b>{n.title}</b><br /><span className="muted">{n.signals.accounts} accounts · {money(n.signals.contractValue)}</span></td>
                <td data-label="Demand"><Level kind="demand" level={n.signals.demandLevel} /></td>
                <td data-label="Strategic Value"><Level kind="strategic" level={n.signals.strategicLevel} /></td>
                <td data-label="Priority" className="prio">{n.priority ?? "—"}</td>
                <td data-label="Status"><NeedStatus status={n.status} /></td>
                <td data-label="Rationale" className="muted">{n.publicRationale ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
