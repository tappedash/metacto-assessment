import { Notice, PageHead, param, type SearchParams } from "@/components/ui";
import { listAccounts } from "@/domain/admin";
import { createAccountAction } from "../actions";

export const dynamic = "force-dynamic";

const money = (n: number | null) => (n == null ? "—" : n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n / 1000)}K`);

export default async function ClientsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const rows = await listAccounts();
  return (
    <>
      <PageHead eyebrow="Clients" title="Clients and their context" lede="Tier, segment and contract value feed Strategic Value. Contract value is visible to Admin and PM only." />
      <Notice notice={param(sp.notice)} error={param(sp.error)} />
      <div className="card flush">
        <table className="stack-sm">
          <thead><tr><th scope="col">Client</th><th scope="col">Type</th><th scope="col">Tier · Segment</th><th scope="col">Contract value</th></tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td className="primary"><b>{a.name}</b></td>
                <td data-label="Type">{a.type === "prospect" ? "Prospect" : "Client"}</td>
                <td data-label="Tier · Segment">{a.tier} · {a.segment}</td>
                <td data-label="Contract value">{a.type === "prospect" ? <span className="muted">pipeline</span> : money(a.contractValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="card section">
        <summary className="strong">Onboard a client</summary>
        <form action={createAccountAction} style={{ marginTop: ".8rem" }}>
          <div className="grid g2">
            <label className="field">Name <span className="req" aria-hidden="true">*</span><input type="text" name="name" required /></label>
            <label className="field">Type<select name="type"><option value="client">Client</option><option value="prospect">Prospect</option></select></label>
            <label className="field">Tier<select name="tier"><option>Enterprise</option><option>Mid-market</option><option>SMB</option></select></label>
            <label className="field">Segment<input type="text" name="segment" placeholder="e.g. Logistics" /></label>
            <label className="field">Contract value (USD)<input type="text" name="contractValue" inputMode="numeric" placeholder="e.g. 250000" /></label>
          </div>
          <button className="btn btn-primary" type="submit">Onboard client</button>
        </form>
      </details>
    </>
  );
}
