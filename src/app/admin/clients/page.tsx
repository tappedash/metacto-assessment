import Link from "next/link";
import { Notice, PageHead, param, type SearchParams } from "@/components/ui";
import { accountOverview, listUsers, type AccountInput } from "@/domain/admin";
import { createAccountAction, inviteCustomerAction, updateAccountAction } from "../actions";

export const dynamic = "force-dynamic";

const money = (n: number | null) => (n == null ? "—" : n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n / 1000)}K`);
const PROJECT_STATUS = { planning: "Planning", active: "Active", done: "Done" } as const;

function AccountFields({ account, pms }: { account?: Partial<AccountInput>; pms: { id: string; name: string }[] }) {
  return (
    <div className="grid g2">
      <label className="field">Name <span className="req" aria-hidden="true">*</span><input type="text" name="name" required defaultValue={account?.name} /></label>
      <label className="field">Type<select name="type" defaultValue={account?.type ?? "client"}><option value="client">Client</option><option value="prospect">Prospect</option></select></label>
      <label className="field">Tier<select name="tier" defaultValue={account?.tier ?? "Enterprise"}><option>Enterprise</option><option>Mid-market</option><option>SMB</option></select></label>
      <label className="field">Segment<input type="text" name="segment" placeholder="e.g. Logistics" defaultValue={account?.segment} /></label>
      <label className="field">Contract value (USD)<input type="text" name="contractValue" inputMode="numeric" placeholder="e.g. 250000" defaultValue={account?.contractValue ?? ""} /></label>
      <label className="field">Responsible PM <span className="hint">(hears about new requests)</span>
        <select name="ownerPmId" defaultValue={account?.ownerPmId ?? ""}><option value="">Any Product Manager</option>{pms.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      </label>
    </div>
  );
}

// Client accounts: context that feeds Strategic Value, plus each account's projects and people.
export default async function ClientsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const [rows, people] = await Promise.all([accountOverview(), listUsers()]);
  const pms = people.filter((u) => u.role === "pm" && u.active);
  return (
    <>
      <PageHead eyebrow="Accounts" title="Client accounts" lede="Tier, segment and contract value feed Strategic Value. Contract value is visible to Admin and PM only. Open an account to edit it, see its projects and people, or invite customer users." />
      <Notice notice={param(sp.notice)} error={param(sp.error)} />
      <div className="stack">
        {rows.map((a) => (
          <details className="card" key={a.id}>
            <summary className="item-head" style={{ justifyContent: "space-between", cursor: "pointer" }}>
              <span><b>{a.name}</b> <span className="muted">· {a.type === "prospect" ? "Prospect" : "Client"} · {a.tier} · {a.segment}</span></span>
              <span className="muted">{a.type === "prospect" ? "pipeline" : money(a.contractValue)} · {a.projects.length} project{a.projects.length === 1 ? "" : "s"} · {a.users.length} user{a.users.length === 1 ? "" : "s"}</span>
            </summary>
            <div className="grid g2" style={{ marginTop: "1rem" }}>
              <div>
                <h3 style={{ fontSize: ".95rem" }}>Projects</h3>
                {a.projects.length ? <ul>{a.projects.map((p) => <li key={p.id}>{p.name} <span className="muted">· {PROJECT_STATUS[p.status]}</span></li>)}</ul> : <p className="muted">No projects yet.</p>}
                <p style={{ marginTop: ".3rem" }}><Link className="btn-link" href="/admin/projects">Manage projects</Link></p>
                <h3 style={{ fontSize: ".95rem", marginTop: ".9rem" }}>Staffed engineers</h3>
                <p className={a.engineers.length ? undefined : "muted"}>{a.engineers.join(", ") || "None yet."}</p>
              </div>
              <div>
                <h3 style={{ fontSize: ".95rem" }}>Customer users</h3>
                {a.users.length ? <ul>{a.users.map((u) => <li key={u.id}>{u.name} <span className="muted">· {u.email}{u.active ? "" : " · deactivated"}</span></li>)}</ul> : <p className="muted">No users yet.</p>}
                <form action={inviteCustomerAction.bind(null, a.id)} className="btn-row" style={{ marginTop: ".6rem", alignItems: "flex-end" }}>
                  <label className="field" style={{ margin: 0 }}>Name<input type="text" name="name" required /></label>
                  <label className="field" style={{ margin: 0 }}>Email<input type="text" name="email" inputMode="email" autoComplete="off" required /></label>
                  <button className="btn btn-ghost btn-sm" type="submit">Invite customer</button>
                </form>
              </div>
            </div>
            <form action={updateAccountAction.bind(null, a.id)} style={{ marginTop: "1.2rem" }}>
              <h3 style={{ fontSize: ".95rem", marginBottom: ".5rem" }}>Edit account</h3>
              <AccountFields account={a} pms={pms} />
              <button className="btn btn-primary btn-sm" type="submit">Save account</button>
            </form>
          </details>
        ))}
      </div>
      <details className="card section">
        <summary className="strong">Onboard a client</summary>
        <form action={createAccountAction} style={{ marginTop: ".8rem" }}>
          <AccountFields pms={pms} />
          <button className="btn btn-primary" type="submit">Onboard client</button>
        </form>
      </details>
    </>
  );
}
