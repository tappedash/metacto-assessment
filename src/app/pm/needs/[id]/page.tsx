import { asc, desc, eq, ne } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Back, NeedStatus, Notice, TicketStatus, param, type SearchParams } from "@/components/ui";
import { EvidenceFiles } from "@/components/evidence-files";
import { attachmentsForRequests } from "@/domain/attachments";
import { getDb } from "@/db/client";
import { accounts, decisions, needs, projects, users } from "@/db/schema";
import { RUBRIC_KEYS } from "@/domain/ai-tasks";
import { ensureNeedInsights, type NeedInsights } from "@/domain/decisions";
import { engineers } from "@/domain/delivery";
import { getNeed, needEvidence, needSignals, needTickets, sentUpdates } from "@/domain/needs";
import { requireActor } from "@/domain/session";
import { createTicketAction, mergeNeedAction, regenerateInsightsAction, saveDecisionAction } from "../../actions";

export const dynamic = "force-dynamic";

const CRITERIA: Record<string, string> = {
  reach: "Reach",
  revenue_impact: "Revenue impact",
  strategic_fit: "Strategic fit",
  severity: "Severity",
};
const DECISIONS = [
  ["plan", "Plan"], ["defer", "Defer"], ["more_info", "Need more info"], ["not_planned", "Not planned"],
] as const;
const money = (n: number) => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n ? `$${Math.round(n / 1000)}K` : "$0");
const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

// The PM's main decision screen: problem -> AI Brief -> Demand / Strategic Value ->
// evidence -> prioritization -> decision -> delivery -> timeline.
export default async function NeedDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const actor = await requireActor(["pm"]);
  const { id } = await params;
  const sp = await searchParams;
  const need = await getNeed(id);
  if (!need) notFound();

  const db = getDb();
  const [signalMap, evidence, ticketRows, decisionRows, updates, otherNeeds, projectRows, engineerRows] = await Promise.all([
    needSignals([id]),
    needEvidence(id, actor),
    needTickets(id),
    db.select({ id: decisions.id, decision: decisions.decision, priority: decisions.priority, rationale: decisions.rationale, by: users.name, at: decisions.createdAt })
      .from(decisions).innerJoin(users, eq(users.id, decisions.decidedBy)).where(eq(decisions.needId, id)).orderBy(desc(decisions.createdAt)),
    sentUpdates(id),
    db.select({ id: needs.id, title: needs.title }).from(needs).where(ne(needs.id, id)).orderBy(asc(needs.title)),
    db.select({ id: projects.id, name: projects.name, account: accounts.name }).from(projects).innerJoin(accounts, eq(accounts.id, projects.accountId)).orderBy(asc(accounts.name), asc(projects.name)),
    engineers(),
  ]);
  const signals = signalMap.get(id)!;
  const files = await attachmentsForRequests(evidence.all.map((e) => e.id));

  // AI Brief + rubric on demand (cached until evidence changes).
  let insights: NeedInsights | null = null;
  let aiError: string | null = null;
  try {
    insights = await ensureNeedInsights(id, actor);
  } catch (error) {
    aiError = (error as Error).message;
  }
  const label = new Map(evidence.all.map((e) => [e.id, e.label]));
  const cite = (ids: string[]) => ids.map((c) => label.get(c)).filter(Boolean).map((l) => <a key={l} className="cite" href={`#ev-${l}`}>{l}</a>);
  const final = (need.rubricFinal ?? {}) as Record<string, number>;
  const aiScore = (key: string) => insights?.rubric.criteria.find((c) => c.key === key);
  const engineerEfforts = ticketRows.filter((t) => t.stage !== "done");
  const suggested = insights?.rubric.suggestedPriority;
  const currentPriority = need.priority ?? suggested ?? "P2";

  return (
    <div className="narrow">
      <Back href="/pm/needs" label="Customer Needs" />
      <Notice notice={param(sp.notice)} error={param(sp.error)} />

      {/* 1. Problem statement */}
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <span className="eyebrow">Customer Need</span>
          <h1>{need.title}</h1>
          <p className="lede">{need.problemStatement}</p>
        </div>
        <NeedStatus status={need.status} />
      </div>

      {/* 2. AI Brief */}
      <div className="section">
        <div className="ai-panel">
          <div className="item-head" style={{ justifyContent: "space-between" }}>
            <span className="ai-tag">AI Brief</span>
            <form action={regenerateInsightsAction.bind(null, id)}><button className="btn-link" type="submit">Regenerate</button></form>
          </div>
          {insights ? (
            <>
              <p>{insights.brief.summary}</p>
              <ul style={{ margin: ".5rem 0 0", paddingLeft: "1.1rem" }}>
                {insights.brief.keyPoints.map((k, i) => <li key={i}>{k.text} {cite(k.citations)}</li>)}
              </ul>
              <div className="based-on">
                <span>Based on</span><b>{signals.requests} Feature Requests</b><b>{signals.accounts} accounts</b><b>{signals.enterpriseAccounts} enterprise accounts</b>
                <a href="#evidence" className="btn-link">View evidence</a>
                <span className="muted">generated {day(insights.generatedAt)}</span>
              </div>
            </>
          ) : (
            <p className="error" role="alert">AI Brief unavailable: {aiError}. Use Regenerate to try again.</p>
          )}
        </div>
      </div>

      {/* 3 + 4. Demand vs Strategic Value */}
      <div className="section grid g2">
        <div className="card panel-demand">
          <div className="section-head" style={{ margin: 0 }}><h2><span className="num">3</span>Demand</h2><span className="muted">How many are asking</span></div>
          <dl className="sig">
            <dt>Linked Feature Requests</dt><dd>{signals.requests}</dd>
            <dt>Unique supporters</dt><dd>{signals.supporters}</dd>
            <dt>Unique accounts</dt><dd>{signals.accounts}</dd>
            <dt>Last 30 days vs prior</dt><dd>{signals.trendPct === null ? `${signals.recent30} new` : `${signals.trendPct >= 0 ? "↑" : "↓"} ${Math.abs(signals.trendPct)}%`}</dd>
          </dl>
        </div>
        <div className="card panel-strategic">
          <div className="section-head" style={{ margin: 0 }}><h2><span className="num">4</span>Strategic Value</h2><span className="muted">How much it matters</span></div>
          <dl className="sig">
            <dt>Enterprise accounts affected</dt><dd>{signals.enterpriseAccounts}</dd>
            <dt>Contract value affected</dt><dd>{money(signals.contractValue)}</dd>
            <dt>Strategic fit (AI)</dt><dd>{aiScore("strategic_fit")?.score ?? "—"} / 5</dd>
            <dt>Severity (AI)</dt><dd>{aiScore("severity")?.score ?? "—"} / 5</dd>
          </dl>
        </div>
      </div>

      {/* 5. Evidence */}
      <div className="section" id="evidence">
        <div className="section-head"><h2><span className="num">5</span>Evidence</h2><span className="muted">Feature Requests, verbatim · {evidence.all.length}</span></div>
        <div className="card flush list">
          {evidence.all.map((e) => (
            <div className="item" key={e.id} id={`ev-${e.label}`}>
              <p className="muted">{e.label} · {e.accountName} · {e.onBehalf ? `logged by engineer ${e.submittedBy}` : e.submittedBy} · {day(e.createdAt)}{e.linkType === "related" ? " · related" : ""}</p>
              <p className="quote">"{e.title}"{e.why ? ` ${e.why}` : ""}</p>
              <EvidenceFiles files={files.get(e.id)} />
            </div>
          ))}
          {!evidence.all.length && <div className="item muted">No confirmed evidence yet.</div>}
        </div>
      </div>

      {/* 6 + 7. Prioritization and decision (one form) */}
      <form action={saveDecisionAction.bind(null, id)}>
        <div className="section">
          <div className="section-head"><h2><span className="num">6</span>Prioritization</h2>{suggested && <span className="ai-tag">AI Recommendation: {suggested}</span>}</div>
          <div className="card">
            <p className="muted" style={{ marginBottom: ".8rem" }}>AI scores each criterion from the evidence. You set the final values (1-5).</p>
            <table className="stack-sm">
              <thead><tr><th scope="col">Criterion</th><th scope="col">AI recommendation</th><th scope="col">PM final</th></tr></thead>
              <tbody>
                {RUBRIC_KEYS.map((key) => {
                  const ai = aiScore(key);
                  return (
                    <tr key={key}>
                      <td className="primary">{CRITERIA[key]}{ai && <><br /><span className="muted">{ai.reason}</span> {cite(ai.citations)}</>}</td>
                      <td data-label="AI"><span className="ai-tag">{ai?.score ?? "—"}</span></td>
                      <td data-label="PM final"><input type="number" name={`final_${key}`} min={1} max={5} defaultValue={final[key] ?? ai?.score ?? 3} aria-label={`${CRITERIA[key]}, PM final`} style={{ width: 72, margin: 0 }} /></td>
                    </tr>
                  );
                })}
                <tr>
                  <td className="primary">Effort <span className="muted">· lower is easier</span><br />
                    <span className="muted">Engineer estimates: {engineerEfforts.length ? engineerEfforts.map((t) => `${t.key}: ${t.effort ?? "not estimated"}`).join(", ") : "none yet"}</span></td>
                  <td data-label="Engineer">—</td>
                  <td data-label="PM final"><input type="number" name="final_effort" min={1} max={5} defaultValue={final.effort ?? 3} aria-label="Effort, PM final" style={{ width: 72, margin: 0 }} /></td>
                </tr>
              </tbody>
            </table>
            <div style={{ marginTop: "1.1rem" }}>
              <fieldset className="segmented">
                <legend>Final priority</legend>
                {(["P0", "P1", "P2", "P3"] as const).map((p) => (
                  <span key={p}>
                    <input type="radio" name="priority" id={`prio-${p}`} value={p} defaultChecked={p === currentPriority} />
                    <label htmlFor={`prio-${p}`}>{p}{p === suggested && <span className="rec"> · AI pick</span>}</label>
                  </span>
                ))}
              </fieldset>
            </div>
          </div>
        </div>

        <div className="section">
          <div className="section-head"><h2><span className="num">7</span>Decision</h2><span className="muted">AI recommends. You decide.</span></div>
          <div className="card">
            <fieldset className="segmented" style={{ marginBottom: "1rem" }}>
              <legend>Decision</legend>
              {DECISIONS.map(([value, text]) => (
                <span key={value}>
                  <input type="radio" name="decision" id={`d-${value}`} value={value} defaultChecked={value === (need.status === "not_planned" ? "not_planned" : "plan")} />
                  <label htmlFor={`d-${value}`}>{text}</label>
                </span>
              ))}
            </fieldset>
            <label className="field" htmlFor="rationale">Rationale <span className="req" aria-hidden="true">*</span> <span className="hint">(required · shown to customers)</span>
              <textarea id="rationale" name="rationale" required defaultValue={need.publicRationale ?? ""} placeholder="Why this decision? Customers will see this." />
            </label>
            <button className="btn btn-primary" type="submit">Save decision</button>
          </div>
        </div>
      </form>

      {/* Delivery: tickets explain "what", this Need explains "why". Not a demand signal. */}
      <div className="section">
        <div className="section-head"><h2>Delivery</h2><span className="muted">Ticket counts don&apos;t measure demand</span></div>
        <div className="card flush">
          <table className="stack-sm">
            <thead><tr><th scope="col">Ticket</th><th scope="col">Project · Client</th><th scope="col">Assignee</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {ticketRows.map((t) => (
                <tr key={t.id}>
                  <td className="primary"><span className="ticket-id">{t.key}</span><br /><Link className="row-link" href={`/pm/tickets/${t.id}`}>{t.title}</Link></td>
                  <td data-label="Project · Client">{t.projectName} · {t.accountName}</td>
                  <td data-label="Assignee">{t.assignee ?? "Unassigned"}</td>
                  <td data-label="Status"><TicketStatus name={t.statusName} stage={t.stage} /></td>
                </tr>
              ))}
              {!ticketRows.length && <tr><td colSpan={4} className="muted">No delivery tickets yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <details className="card" style={{ marginTop: ".75rem" }}>
          <summary className="strong">Create a delivery ticket</summary>
          <form action={createTicketAction.bind(null, id)} style={{ marginTop: ".8rem" }}>
            <label className="field">Title <span className="req" aria-hidden="true">*</span><input type="text" name="title" required /></label>
            <div className="grid g2">
              <label className="field">Project
                <select name="projectId" required>{projectRows.map((p) => <option key={p.id} value={p.id}>{p.account} · {p.name}</option>)}</select>
              </label>
              <label className="field">Assignee
                <select name="assigneeId"><option value="">Unassigned</option>{engineerRows.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
              </label>
              <label className="field">Priority
                <select name="priority" defaultValue={need.priority ?? ""}><option value="">—</option>{["P0", "P1", "P2", "P3"].map((p) => <option key={p}>{p}</option>)}</select>
              </label>
              <label className="field">Effort
                <select name="effort"><option value="">—</option>{["S", "M", "L", "XL"].map((e) => <option key={e}>{e}</option>)}</select>
              </label>
            </div>
            <button className="btn btn-dark btn-sm" type="submit">Create in backlog</button>
          </form>
        </details>
      </div>

      {/* 8. Timeline / communication */}
      <div className="section">
        <div className="section-head"><h2><span className="num">8</span>Timeline</h2><Link className="btn-link" href="/pm/updates">Updates</Link></div>
        <div className="card">
          <ol className="timeline">
            {[
              ...decisionRows.map((d) => ({ at: d.at, node: <><span className="strong">Decision: {DECISIONS.find(([v]) => v === d.decision)?.[1]}{d.priority ? ` · ${d.priority}` : ""}</span> <span className="when">· {day(d.at)} · {d.by}</span><br /><span className="muted">{d.rationale}</span></> })),
              ...updates.map((u) => ({ at: u.sentAt!, node: <><span className="strong">Update sent: {u.subject}</span> <span className="when">· {day(u.sentAt!)}</span></> })),
              { at: need.createdAt, node: <><span className="strong">Customer Need created</span> <span className="when">· {day(need.createdAt)}</span></> },
            ].sort((a, b) => b.at.getTime() - a.at.getTime()).map((e, i) => <li key={i} className={i === 0 ? "now" : "done"}>{e.node}</li>)}
          </ol>
        </div>
      </div>

      {otherNeeds.length > 0 && (
        <details className="card section">
          <summary className="strong">Merge this Need into another (duplicate)</summary>
          <form action={mergeNeedAction.bind(null, id)} className="btn-row" style={{ marginTop: ".8rem" }}>
            <label className="sr-only" htmlFor="merge-target">Merge into</label>
            <select id="merge-target" name="targetId" style={{ marginTop: 0, maxWidth: 360 }}>{otherNeeds.map((n) => <option key={n.id} value={n.id}>{n.title}</option>)}</select>
            <button className="btn btn-ghost btn-sm" type="submit">Merge</button>
          </form>
        </details>
      )}
    </div>
  );
}
