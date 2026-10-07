import { Notice, PageHead, param, type SearchParams } from "@/components/ui";
import { listAccounts, listUsers } from "@/domain/admin";
import { ROLE_LABEL } from "@/domain/labels";
import { requireActor } from "@/domain/session";
import { createUserAction, setUserRoleAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function UsersPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireActor(["admin"]);
  const sp = await searchParams;
  const [rows, accounts] = await Promise.all([listUsers(), listAccounts()]);
  return (
    <>
      <PageHead eyebrow="Users" title="People and roles" lede="Admin · Product Manager · Engineer · Client user. Roles decide what each person can see and do." />
      <Notice notice={param(sp.notice)} error={param(sp.error)} />
      <div className="card flush">
        <table className="stack-sm">
          <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th></tr></thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td className="primary"><b>{u.name}</b>{u.accountName ? <span className="muted"> · {u.accountName}</span> : null}</td>
                <td data-label="Email">{u.email}</td>
                <td data-label="Role">
                  {u.role === "client" || u.id === actor.id ? ROLE_LABEL[u.role] : (
                    <form action={setUserRoleAction.bind(null, u.id)} className="btn-row">
                      <label className="sr-only" htmlFor={`role-${u.id}`}>Role for {u.name}</label>
                      <select id={`role-${u.id}`} name="role" defaultValue={u.role} style={{ margin: 0, width: "auto" }}>
                        <option value="engineer">Engineer</option><option value="pm">Product Manager</option><option value="admin">Workspace Admin</option>
                      </select>
                      <button className="btn btn-ghost btn-sm" type="submit">Save</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="card section">
        <summary className="strong">Invite a user</summary>
        <form action={createUserAction} style={{ marginTop: ".8rem" }}>
          <div className="grid g2">
            <label className="field">Name <span className="req" aria-hidden="true">*</span><input type="text" name="name" required /></label>
            <label className="field">Email <span className="req" aria-hidden="true">*</span><input type="text" name="email" inputMode="email" autoComplete="off" required /></label>
            <label className="field">Role<select name="role"><option value="engineer">Engineer</option><option value="pm">Product Manager</option><option value="client">Client user</option><option value="admin">Workspace Admin</option></select></label>
            <label className="field">Client account <span className="hint">(client users)</span><select name="accountId"><option value="">—</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          </div>
          <button className="btn btn-primary" type="submit">Add user</button>
        </form>
      </details>
    </>
  );
}
