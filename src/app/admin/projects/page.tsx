import { ProjectIntegrationsPanel } from "@/components/integrations";
import { Notice, PageHead, param, type SearchParams } from "@/components/ui";
import { listAccounts, listProjectsAdmin } from "@/domain/admin";
import { engineers } from "@/domain/delivery";
import { projectIntegrationsFor } from "@/domain/integrations";
import { assignEngineerAction, createProjectAction, removeEngineerAction, updateProjectAction } from "../actions";

export const dynamic = "force-dynamic";

const STATUS = [["planning", "Planning"], ["active", "Active"], ["done", "Done"]] as const;

function ProjectFields({ project, accounts }: { project?: { name: string; accountId: string; status: string }; accounts: { id: string; name: string }[] }) {
  return (
    <div className="grid g2">
      <label className="field">Name <span className="req" aria-hidden="true">*</span><input type="text" name="name" required defaultValue={project?.name} /></label>
      <label className="field">Client account<select name="accountId" defaultValue={project?.accountId} required>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label className="field">Status<select name="status" defaultValue={project?.status ?? "active"}>{STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
    </div>
  );
}

// Projects (engagements): each belongs to one client account. Assigning an engineer staffs
// them on that account, which decides what they can see.
export default async function AdminProjectsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const [rows, accounts, people] = await Promise.all([listProjectsAdmin(), listAccounts(), engineers()]);
  const integrations = await Promise.all(rows.map((p) => projectIntegrationsFor(p.id)));
  return (
    <>
      <PageHead eyebrow="Projects" title="Engagements and who works on them" lede="Staffing is Engineer → Account → Project: adding an engineer to a project also staffs them on its client, so they see that client's requests and tickets. Ticket statuses are configured by the PM." />
      <Notice notice={param(sp.notice)} error={param(sp.error)} />
      <div className="stack">
        {rows.map((p, i) => {
          const available = people.filter((e) => !p.engineers.some((m) => m.userId === e.id));
          return (
            <details className="card" key={p.id}>
              <summary className="item-head" style={{ justifyContent: "space-between", cursor: "pointer" }}>
                <span><b>{p.name}</b> <span className="muted">· {p.accountName} · {STATUS.find(([v]) => v === p.status)?.[1]}</span></span>
                <span className="muted">{p.engineers.map((e) => e.name).join(", ") || "No engineers"} · {p.tickets} ticket{p.tickets === 1 ? "" : "s"}</span>
              </summary>
              <div style={{ marginTop: "1rem" }}>
                <h3 style={{ fontSize: ".95rem" }}>Engineers</h3>
                <ul className="btn-row" style={{ margin: ".4rem 0" }}>
                  {p.engineers.map((e) => (
                    <li key={e.userId} className="chip st-planned">
                      {e.name}
                      <form action={removeEngineerAction.bind(null, p.id, e.userId)} style={{ display: "inline" }}>
                        <button className="btn-link" type="submit" aria-label={`Remove ${e.name} from ${p.name}`} style={{ marginLeft: ".3rem" }}>×</button>
                      </form>
                    </li>
                  ))}
                </ul>
                {available.length > 0 && (
                  <form action={assignEngineerAction.bind(null, p.id)} className="btn-row" style={{ alignItems: "flex-end" }}>
                    <label className="field" style={{ margin: 0 }}>Add engineer<select name="engineerId">{available.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
                    <button className="btn btn-ghost btn-sm" type="submit">Add</button>
                  </form>
                )}
              </div>
              <form action={updateProjectAction.bind(null, p.id)} style={{ marginTop: "1.2rem" }}>
                <h3 style={{ fontSize: ".95rem", marginBottom: ".5rem" }}>Edit project</h3>
                <ProjectFields project={p} accounts={accounts} />
                <button className="btn btn-primary btn-sm" type="submit">Save project</button>
              </form>
              <ProjectIntegrationsPanel projectId={p.id} back="/admin/projects" jira={integrations[i].jira} github={integrations[i].github} />
            </details>
          );
        })}
      </div>
      <details className="card section">
        <summary className="strong">Create a project</summary>
        <form action={createProjectAction} style={{ marginTop: ".8rem" }}>
          <ProjectFields accounts={accounts} />
          <p className="muted" style={{ marginBottom: ".8rem" }}>New projects start with the default workflow: Backlog → Planned → In Development → Released.</p>
          <button className="btn btn-primary" type="submit">Create project</button>
        </form>
      </details>
    </>
  );
}
