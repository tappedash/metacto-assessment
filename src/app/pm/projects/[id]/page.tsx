import Link from "next/link";
import { notFound } from "next/navigation";
import { Back, Notice, TicketStatus, param, type SearchParams } from "@/components/ui";
import { ProjectIntegrationsPanel, ProjectTraceability } from "@/components/integrations";
import { listProjects, listTickets } from "@/domain/delivery";
import { projectActivity, projectIntegrationsFor } from "@/domain/integrations";
import { requireActor } from "@/domain/session";
import { STAGES, STAGE_LABEL, projectWorkflow, ticketCountsByStatus } from "@/domain/workflow";
import { addStatusAction, moveStatusAction, removeStatusAction, updateStatusAction } from "../../actions";

export const dynamic = "force-dynamic";

const STAGE_HELP: Record<string, string> = {
  backlog: "New tickets start here. Only you move tickets out of Backlog.",
  planned: "Agreed and scheduled. Engineers can pick these up.",
  in_progress: "Being built, reviewed or tested. The first ticket here moves the Customer Need to In Development.",
  done: "Finished. When every ticket of a Customer Need is Done, the Need moves to Released.",
};

// The PM configures this project's ticket statuses. Stages keep the product rules working.
export default async function ProjectWorkflowPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const actor = await requireActor(["pm"]);
  const { id } = await params;
  const sp = await searchParams;
  const project = (await listProjects(actor)).find((p) => p.id === id);
  if (!project) notFound();
  const [workflow, counts, projectTickets, activity, integrations] = await Promise.all([projectWorkflow(id), ticketCountsByStatus(id), listTickets(actor, { projectId: id }), projectActivity(actor, id), projectIntegrationsFor(id)]);

  return (
    <div className="narrow">
      <Back href="/pm/projects" label="Projects" />
      <div className="page-head">
        <div>
          <span className="eyebrow">{project.accountName}</span>
          <h1>{project.name}</h1>
          <p className="lede">Rename, add, reorder or remove statuses to fit how this engagement works. Customers never see these names, only Planned, In Development, Ready for Review or Released.</p>
        </div>
        <Link className="btn btn-ghost btn-sm" href={`/pm/tickets?project=${id}`}>Open board</Link>
      </div>
      <Notice notice={param(sp.notice)} error={param(sp.error)} />

      <div className="card" style={{ marginBottom: "1.25rem" }}>
        <span className="eyebrow">Preview</span>
        <div className="btn-row">{workflow.map((s, i) => <span key={s.id} className="btn-row">{i > 0 && <span className="muted">→</span>}<TicketStatus name={s.name} stage={s.stage} /></span>)}</div>
      </div>

      {STAGES.map((stage) => {
        const group = workflow.filter((s) => s.stage === stage);
        return (
          <section className="section" key={stage} aria-labelledby={`stage-${stage}`}>
            <div className="section-head"><h2 id={`stage-${stage}`}>{STAGE_LABEL[stage]}</h2><span className="muted">{STAGE_HELP[stage]}</span></div>
            <div className="card flush list">
              {group.map((s, i) => {
                const n = counts.get(s.id) ?? 0;
                const replacements = workflow.filter((o) => o.id !== s.id);
                return (
                  <div className="item stack" key={s.id}>
                    <form action={updateStatusAction.bind(null, id, s.id)} className="wf-row">
                      <label className="sr-only" htmlFor={`name-${s.id}`}>Status name</label>
                      <input id={`name-${s.id}`} type="text" name="name" defaultValue={s.name} required style={{ margin: 0 }} />
                      <label className="sr-only" htmlFor={`stage-${s.id}`}>Stage for {s.name}</label>
                      <select id={`stage-${s.id}`} name="stage" defaultValue={s.stage} style={{ margin: 0 }}>
                        {STAGES.map((st) => <option key={st} value={st}>{STAGE_LABEL[st]}</option>)}
                      </select>
                      {s.stage === "in_progress" ? (
                        <>
                          <label className="sr-only" htmlFor={`cust-${s.id}`}>What customers see for {s.name}</label>
                          <select id={`cust-${s.id}`} name="customerLabel" defaultValue={s.publicStatus === "ready_for_review" ? "ready_for_review" : "in_development"} style={{ margin: 0 }} title="What customers see">
                            <option value="in_development">Customers see: In Development</option>
                            <option value="ready_for_review">Customers see: Ready for Review</option>
                          </select>
                        </>
                      ) : <span className="muted" style={{ fontSize: 12 }}>Customers see: {s.stage === "backlog" ? "nothing (hidden)" : s.stage === "planned" ? "Planned" : "Released"}</span>}
                      <div className="btn-row">
                        <button className="btn btn-ghost btn-sm" type="submit">Save</button>
                        <button className="btn btn-ghost btn-sm" type="submit" formAction={moveStatusAction.bind(null, id, s.id, "up")} disabled={i === 0} aria-label={`Move ${s.name} up`}>↑</button>
                        <button className="btn btn-ghost btn-sm" type="submit" formAction={moveStatusAction.bind(null, id, s.id, "down")} disabled={i === group.length - 1} aria-label={`Move ${s.name} down`}>↓</button>
                      </div>
                    </form>
                    <form action={removeStatusAction.bind(null, id, s.id)} className="btn-row">
                      <span className="muted">{n} ticket{n === 1 ? "" : "s"}</span>
                      {n > 0 && (
                        <>
                          <label className="muted" htmlFor={`repl-${s.id}`}>move them to</label>
                          <select id={`repl-${s.id}`} name="replacementId" style={{ margin: 0, width: "auto" }}>
                            {replacements.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                          </select>
                        </>
                      )}
                      <button className="btn-link" type="submit">Remove status</button>
                    </form>
                  </div>
                );
              })}
              {!group.length && <div className="item muted">No {STAGE_LABEL[stage]} statuses.</div>}
            </div>
          </section>
        );
      })}

      <form action={addStatusAction.bind(null, id)} className="card section">
        <h2 style={{ marginBottom: ".8rem" }}>Add a status</h2>
        <div className="wf-row">
          <label className="sr-only" htmlFor="new-name">Name</label>
          <input id="new-name" type="text" name="name" placeholder="e.g. In QA, UAT, Client sign-off" required style={{ margin: 0 }} />
          <label className="sr-only" htmlFor="new-stage">Stage</label>
          <select id="new-stage" name="stage" defaultValue="in_progress" style={{ margin: 0 }}>
            {STAGES.map((st) => <option key={st} value={st}>{STAGE_LABEL[st]}</option>)}
          </select>
          <button className="btn btn-primary btn-sm" type="submit">Add status</button>
        </div>
        <p className="muted" style={{ marginTop: ".6rem" }}>New statuses go at the end of their stage. Use ↑ ↓ to reorder within a stage.</p>
      </form>
      <ProjectTraceability rows={projectTickets} activity={activity} ticketHref={(t) => `/pm/tickets/${t}`} needHref={(n) => `/pm/needs/${n}`} />
      <ProjectIntegrationsPanel projectId={id} back={`/pm/projects/${id}`} jira={integrations.jira} github={integrations.github} />
    </div>
  );
}
