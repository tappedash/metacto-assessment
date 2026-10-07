// Optional, project-level integrations. Needs Hub works fully without them: the local
// connector keeps tickets in Needs Hub only.

export interface ExternalIssue {
  key: string; // PROJ-184
  url: string;
  status: string;
  assignee: string | null;
}

export interface IssueRef {
  externalKey: string;
  /** Local status and assignee, used only by the offline demo connector. */
  local: { status: string; stage: string; assignee: string | null };
}

export interface TicketConnector {
  kind: "local" | "jira";
  /** Creates the external issue for a Needs Hub ticket; null when there is no external system. */
  createIssue(ticket: { key: string; title: string; needTitle: string; link: string; local: IssueRef["local"] }): Promise<ExternalIssue | null>;
  /** Current status and assignee of a linked issue. */
  fetchIssue(ref: IssueRef): Promise<{ status: string; assignee: string | null; blocked: boolean } | null>;
}

export const LocalTicketConnector: TicketConnector = {
  kind: "local",
  createIssue: async () => null,
  fetchIssue: async () => null,
};

export interface JiraConfig { siteUrl: string; projectKey: string; email: string; issueType: string; demo: boolean }
export interface GithubConfig { repos: string[]; demo: boolean }

export interface GithubItem {
  kind: "commit" | "pull_request" | "branch";
  repo: string;
  ref: string; // sha, PR number or branch name
  title: string; // commit message (first line), PR title or branch name
  branch?: string; // a PR's head branch, also searched for ticket keys
  author: string | null;
  url: string;
  occurredAt: Date;
}

export type FetchFn = typeof fetch;
