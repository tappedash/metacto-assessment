import { Notice, PageHead, param, type SearchParams } from "@/components/ui";
import { listAccounts, listUsers } from "@/domain/admin";
import { listPendingInvitations } from "@/domain/invitations";
import { ROLE_LABEL } from "@/domain/labels";
import { requireActor } from "@/domain/session";
import { inviteUserAction, resendInvitationAction, revokeInvitationAction, setUserActiveAction, setUserRoleAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function UsersPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireActor(["admin"]);
  const sp = await searchParams;
  const [rows, accounts, pending] = await Promise.all([listUsers(), listAccounts(), listPendingInvitations()]);
  return (
    <>
      <PageHead eyebrow="Users" title="People and roles" lede="Four fixed roles: Admin · Product Manager · Engineer · Client user. Roles decide what each person can see and do; deactivated people can't sign in." />
      <Notice notice={param(sp.notice)} error={param(sp.error)} />
      <div className="card flush">
        <table className="stack-sm">
          <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Access</th></tr></thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className={u.active ? undefined : "muted"}>
                <td className="primary"><b>{u.name}</b>{u.accountName ? <span className="muted"> · {u.accountName}</span> : null}</td>
                <td data-label="Email">{u.email}</td>
                <td data-label="Role">
                  {u.id === actor.id ? ROLE_LABEL[u.role] : (
                    <form action={setUserRoleAction.bind(null, u.id)} className="btn-row">
                      <label className="sr-only" htmlFor={`role-${u.id}`}>Role for {u.name}</label>
                      <select id={`role-${u.id}`} name="role" defaultValue={u.role} style={{ margin: 0, width: "auto" }}>
                        <option value="engineer">Engineer</option><option value="pm">Product Manager</option><option value="client">Client user</option><option value="admin">Workspace Admin</option>
                      </select>
                      <label className="sr-only" htmlFor={`acct-${u.id}`}>Client account for {u.name}</label>
                      <select id={`acct-${u.id}`} name="accountId" defaultValue={u.accountId ?? ""} style={{ margin: 0, width: "auto" }} title="Client account (client users only)">
                        <option value="">No client account</option>
                        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                      <button className="btn btn-ghost btn-sm" type="submit">Save</button>
                    </form>
                  )}
                </td>
                <td data-label="Access">
                  {u.id === actor.id ? "Active" : (
                    <form action={setUserActiveAction.bind(null, u.id, !u.active)} className="btn-row">
                      <span>{u.active ? "Active" : "Deactivated"}</span>
                      <button className="btn-link" type="submit">{u.active ? "Deactivate" : "Reactivate"}</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="section">
        <div className="section-head"><h2>Pending invitations</h2><span className="muted">Access starts at their first sign-in</span></div>
        <div className="card flush">
          <table className="stack-sm">
            <thead><tr><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Client account</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {pending.map((p) => (
                <tr key={p.id}>
                  <td className="primary"><b>{p.email}</b>{p.name ? <span className="muted"> · {p.name}</span> : null}</td>
                  <td data-label="Role">{ROLE_LABEL[p.role]}</td>
                  <td data-label="Client account">{p.accountName ?? "—"}</td>
                  <td data-label="">
                    <div className="btn-row">
                      <form action={resendInvitationAction.bind(null, p.id)}><button className="btn-link" type="submit">Resend</button></form>
                      <form action={revokeInvitationAction.bind(null, p.id)}><button className="btn-link" type="submit">Revoke</button></form>
                    </div>
                  </td>
                </tr>
              ))}
              {!pending.length && <tr><td colSpan={4} className="muted">No pending invitations.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <details className="card section" open={pending.length === 0}>
        <summary className="strong">Invite a user</summary>
        <form action={inviteUserAction} style={{ marginTop: ".8rem" }}>
          <div className="grid g2">
            <label className="field">Name <span className="req" aria-hidden="true">*</span><input type="text" name="name" required /></label>
            <label className="field">Email <span className="req" aria-hidden="true">*</span><input type="text" name="email" inputMode="email" autoComplete="off" required /></label>
            <label className="field">Role<select name="role"><option value="engineer">Engineer</option><option value="pm">Product Manager</option><option value="client">Client user</option><option value="admin">Workspace Admin</option></select></label>
            <label className="field">Client account <span className="hint">(client users)</span><select name="accountId"><option value="">—</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          </div>
          <p className="muted" style={{ marginBottom: ".8rem" }}>They&apos;ll get an email and can sign in with Google or a magic link using this address. Client users must have a client account.</p>
          <button className="btn btn-primary" type="submit">Send invitation</button>
        </form>
      </details>
    </>
  );
}
