import Link from "next/link";
import { disconnectAction, linkJiraAction, saveGithubAction, saveJiraAction, syncAction } from "@/app/actions/integrations";
import type { IntegrationView } from "@/domain/integrations";
import type { GithubConfig, JiraConfig } from "@/integrations/types";

const when = (d: Date | null) => (d ? d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "never");
const KIND_LABEL = { commit: "Commit", pull_request: "PR", branch: "Branch" } as const;
const shortRef = (kind: keyof typeof KIND_LABEL, ref: string) => (kind === "commit" ? ref.slice(0, 7) : kind === "pull_request" ? `#${ref}` : ref);

/**
 * Project -> Integrations. Both are optional: without them, tickets live in Needs Hub only.
 * Tokens are write-only (stored encrypted, never shown again).
 */
export function ProjectIntegrationsPanel({ projectId, back, jira, github }: { projectId: string; back: string; jira: IntegrationView | null; github: IntegrationView | null }) {
  const j = jira?.config as JiraConfig | undefined;
  const g = github?.config as GithubConfig | undefined;
  return (
    <section className="section" aria-labelledby="integrations-h">
      <div className="section-head"><h2 id="integrations-h">Integrations</h2><span className="muted">Optional · internal only, customers never see Jira or GitHub</span></div>
      <div className="grid g2">
        <details className="card" open={Boolean(jira)}>
          <summary className="strong">Jira {jira ? (jira.enabled ? "· connected" : "· disabled") : "· not connected"}</summary>
          {jira && <p className="muted" style={{ marginTop: ".5rem" }}>Last sync {when(jira.lastSyncAt)}{jira.lastError && <span className="error"> · {jira.lastError}</span>}</p>}
          <form action={saveJiraAction.bind(null, projectId, back)} style={{ marginTop: ".6rem" }}>
            <label className="field">Jira site<input type="text" name="siteUrl" required placeholder="https://your-team.atlassian.net" defaultValue={j?.siteUrl} /></label>
            <div className="grid g2">
              <label className="field">Jira project key<input type="text" name="projectKey" required placeholder="PROJ" defaultValue={j?.projectKey} /></label>
              <label className="field">Issue type<input type="text" name="issueType" placeholder="Task" defaultValue={j?.issueType} /></label>
            </div>
            <label className="field">Account email<input type="text" name="email" inputMode="email" autoComplete="off" defaultValue={j?.email} /></label>
            <label className="field">API token <span className="hint">{jira?.hasToken ? "(saved; leave blank to keep)" : ""}</span><input type="password" name="token" autoComplete="off" /></label>
            <label className="check"><input type="checkbox" name="enabled" defaultChecked={jira?.enabled ?? true} /> Sync enabled</label>
            <label className="check"><input type="checkbox" name="demo" defaultChecked={j?.demo ?? false} /> Offline demo mode (no Jira calls)</label>
            <div className="btn-row" style={{ marginTop: ".6rem" }}><button className="btn btn-primary btn-sm" type="submit">Save Jira</button></div>
          </form>
          {jira && (
            <div className="btn-row" style={{ marginTop: ".5rem" }}>
              <form action={syncAction.bind(null, projectId, "jira", back)}><button className="btn btn-ghost btn-sm" type="submit">Sync now</button></form>
              <form action={disconnectAction.bind(null, projectId, "jira", back)}><button className="btn-link" type="submit">Disconnect</button></form>
            </div>
          )}
        </details>
        <details className="card" open={Boolean(github)}>
          <summary className="strong">GitHub {github ? (github.enabled ? `· ${g?.repos.length} repositor${g?.repos.length === 1 ? "y" : "ies"}` : "· disabled") : "· not connected"}</summary>
          {github && <p className="muted" style={{ marginTop: ".5rem" }}>Last sync {when(github.lastSyncAt)}{github.lastError && <span className="error"> · {github.lastError}</span>}</p>}
          <form action={saveGithubAction.bind(null, projectId, back)} style={{ marginTop: ".6rem" }}>
            <label className="field">Repositories <span className="hint">(one per line, owner/name)</span>
              <textarea name="repos" required placeholder={"company/reporting-api\ncompany/reporting-web"} defaultValue={g?.repos.join("\n")} />
            </label>
            <label className="field">Token <span className="hint">{github?.hasToken ? "(saved; leave blank to keep)" : "(optional for public repositories)"}</span><input type="password" name="token" autoComplete="off" /></label>
            <label className="check"><input type="checkbox" name="enabled" defaultChecked={github?.enabled ?? true} /> Sync enabled</label>
            <label className="check"><input type="checkbox" name="demo" defaultChecked={g?.demo ?? false} /> Offline demo mode (sample activity)</label>
            <p className="muted" style={{ fontSize: 12 }}>Commits, PRs and branches that mention a ticket key (e.g. <code>T-107</code> or <code>CARR-184</code>) are linked to that ticket.</p>
            <div className="btn-row" style={{ marginTop: ".6rem" }}><button className="btn btn-primary btn-sm" type="submit">Save GitHub</button></div>
          </form>
          {github && (
            <div className="btn-row" style={{ marginTop: ".5rem" }}>
              <form action={syncAction.bind(null, projectId, "github", back)}><button className="btn btn-ghost btn-sm" type="submit">Sync now</button></form>
              <form action={disconnectAction.bind(null, projectId, "github", back)}><button className="btn-link" type="submit">Disconnect</button></form>
            </div>
          )}
        </details>
      </div>
    </section>
  );
}

interface ExternalTicket { id: string; externalKey: string | null; externalUrl: string | null; externalStatus: string | null; externalAssignee: string | null; syncedAt: Date | null }
interface Activity { id: string; kind: keyof typeof KIND_LABEL; repo: string; ref: string; title: string; author: string | null; url: string; occurredAt: Date }

/** Ticket detail (team only): the linked Jira issue and the engineering work that delivered it. */
export function TicketEngineering({ ticket, activity, jiraConnected, canLink }: { ticket: ExternalTicket; activity: Activity[]; jiraConnected: boolean; canLink: boolean }) {
  if (!ticket.externalKey && !activity.length && !(jiraConnected && canLink)) return null;
  return (
    <section className="card section" aria-label="Engineering">
      {ticket.externalKey ? (
        <dl className="meta-grid">
          <div><dt>Jira issue</dt><dd><a className="btn-link" href={ticket.externalUrl ?? "#"} target="_blank" rel="noreferrer">{ticket.externalKey}</a></dd></div>
          <div><dt>Jira status</dt><dd>{ticket.externalStatus ?? "—"}</dd></div>
          <div><dt>Jira assignee</dt><dd>{ticket.externalAssignee ?? "Unassigned"}</dd></div>
          <div><dt>Last sync</dt><dd>{when(ticket.syncedAt)}</dd></div>
        </dl>
      ) : jiraConnected && canLink ? (
        <form action={linkJiraAction.bind(null, ticket.id)} className="btn-row">
          <span className="muted">This project uses Jira.</span>
          <button className="btn btn-ghost btn-sm" type="submit">Create Jira issue</button>
        </form>
      ) : null}
      {activity.length > 0 && (
        <>
          <h2 style={{ fontSize: "1.05rem", margin: ticket.externalKey || jiraConnected ? "1rem 0 .5rem" : "0 0 .5rem" }}>Development activity</h2>
          <ul className="stack" style={{ gap: ".3rem" }}>
            {activity.map((a) => (
              <li key={a.id}>
                <a className="btn-link" href={a.url} target="_blank" rel="noreferrer">{KIND_LABEL[a.kind]} {shortRef(a.kind, a.ref)}</a>
                {a.kind !== "branch" && <> — {a.title}</>} <span className="muted">· {a.repo}{a.author ? ` · ${a.author}` : ""} · {when(a.occurredAt)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** Project traceability: Customer Need -> Delivery Ticket (local / Jira) -> GitHub activity. */
export function ProjectTraceability({ rows, activity, ticketHref, needHref }: {
  rows: { id: string; key: string; title: string; statusName: string; externalKey: string | null; needId: string; needTitle: string }[];
  activity: (Activity & { ticketKey: string | null })[];
  ticketHref: (id: string) => string;
  needHref: (id: string) => string;
}) {
  const needs = [...new Map(rows.map((r) => [r.needId, r.needTitle])).entries()];
  return (
    <section className="section" aria-labelledby="trace-h">
      <div className="section-head"><h2 id="trace-h">Why and what delivered it</h2><span className="muted">Customer Need → ticket → Jira → GitHub</span></div>
      <div className="grid split">
        <div className="card">
          {needs.length ? needs.map(([needId, title]) => (
            <div key={needId} style={{ marginBottom: ".8rem" }}>
              <Link className="btn-link strong" href={needHref(needId)}>{title}</Link>
              <ul style={{ margin: ".3rem 0 0 1rem" }}>
                {rows.filter((r) => r.needId === needId).map((r) => (
                  <li key={r.id}><Link className="btn-link" href={ticketHref(r.id)}>{r.key}{r.externalKey ? ` · ${r.externalKey}` : ""}</Link> {r.title} <span className="muted">· {r.statusName} · {activity.filter((a) => a.ticketKey === r.key).length} GitHub item(s)</span></li>
                ))}
              </ul>
            </div>
          )) : <p className="muted">No tickets yet.</p>}
        </div>
        <div className="card">
          <h3 style={{ fontSize: ".95rem", marginBottom: ".5rem" }}>Recent GitHub activity</h3>
          {activity.length ? (
            <ul className="stack" style={{ gap: ".3rem" }}>
              {activity.map((a) => (
                <li key={a.id}><a className="btn-link" href={a.url} target="_blank" rel="noreferrer">{KIND_LABEL[a.kind]} {shortRef(a.kind, a.ref)}</a> {a.kind !== "branch" && a.title} <span className="muted">· {a.ticketKey ?? "not linked"}</span></li>
              ))}
            </ul>
          ) : <p className="muted">No GitHub activity. Connect repositories under Integrations (optional).</p>}
        </div>
      </div>
    </section>
  );
}
