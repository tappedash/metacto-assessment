import type { FetchFn, JiraConfig, TicketConnector } from "./types";

// Jira Cloud REST API v3, kept to two calls: create an issue, read its status and assignee.
// demo: true runs offline (no network) so the seeded demo works without a Jira site.

const DEMO_STATUS: Record<string, string> = { backlog: "Backlog", planned: "To Do", in_progress: "In Progress", done: "Done" };

export function jiraConnector(config: JiraConfig, token: string | null, fetchFn: FetchFn = fetch, existingCount = 0): TicketConnector {
  const site = config.siteUrl.replace(/\/+$/, "");
  if (config.demo) {
    return {
      kind: "jira",
      createIssue: async (t) => {
        const key = `${config.projectKey}-${184 + existingCount}`;
        return { key, url: `${site}/browse/${key}`, status: DEMO_STATUS[t.local.stage] ?? t.local.status, assignee: t.local.assignee };
      },
      fetchIssue: async (ref) => ({ status: DEMO_STATUS[ref.local.stage] ?? ref.local.status, assignee: ref.local.assignee, blocked: false }),
    };
  }
  if (!token) throw new Error("Add a Jira API token to connect");
  const headers = {
    Authorization: `Basic ${Buffer.from(`${config.email}:${token}`).toString("base64")}`,
    Accept: "application/json", "Content-Type": "application/json",
  };
  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetchFn(`${site}${path}`, { ...init, headers, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Jira responded ${res.status}${res.status === 401 ? " (check the email and API token)" : ""}`);
    return res.json() as Promise<T>;
  }
  async function read(key: string) {
    const issue = await call<{ fields: { status: { name: string }; assignee: { displayName: string } | null } }>(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=status,assignee`);
    const status = issue.fields.status.name;
    return { status, assignee: issue.fields.assignee?.displayName ?? null, blocked: /block/i.test(status) };
  }
  return {
    kind: "jira",
    createIssue: async (t) => {
      const text = `Customer Need: ${t.needTitle}\nNeeds Hub ticket ${t.key}: ${t.link}`;
      const created = await call<{ key: string }>("/rest/api/3/issue", {
        method: "POST",
        body: JSON.stringify({
          fields: {
            project: { key: config.projectKey }, summary: t.title, issuetype: { name: config.issueType || "Task" },
            description: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
          },
        }),
      });
      const now = await read(created.key);
      return { key: created.key, url: `${site}/browse/${created.key}`, status: now.status, assignee: now.assignee };
    },
    fetchIssue: (ref) => read(ref.externalKey),
  };
}
