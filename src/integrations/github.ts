import type { FetchFn, GithubItem } from "./types";

// GitHub REST API: recent commits, pull requests and branches of a repository. No webhooks:
// a "Sync now" pulls the latest page of each. demo: true returns fixed sample activity.

export async function fetchGithubActivity(repo: string, token: string | null, fetchFn: FetchFn = fetch): Promise<GithubItem[]> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "needs-hub" };
  if (token) headers.Authorization = `Bearer ${token}`;
  async function call<T>(path: string): Promise<T> {
    const res = await fetchFn(`https://api.github.com/repos/${repo}${path}`, { headers, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`GitHub responded ${res.status} for ${repo}${res.status === 404 ? " (check the name, or add a token for private repos)" : ""}`);
    return res.json() as Promise<T>;
  }
  const [commits, pulls, branches] = await Promise.all([
    call<{ sha: string; html_url: string; commit: { message: string; author: { name: string; date: string } | null }; author: { login: string } | null }[]>("/commits?per_page=50"),
    call<{ number: number; title: string; html_url: string; created_at: string; user: { login: string } | null; head: { ref: string } }[]>("/pulls?state=all&per_page=50"),
    call<{ name: string }[]>("/branches?per_page=100"),
  ]);
  const now = new Date();
  return [
    ...commits.map((c) => ({ kind: "commit" as const, repo, ref: c.sha, title: c.commit.message.split("\n")[0], author: c.author?.login ?? c.commit.author?.name ?? null, url: c.html_url, occurredAt: new Date(c.commit.author?.date ?? now) })),
    ...pulls.map((p) => ({ kind: "pull_request" as const, repo, ref: String(p.number), title: p.title, branch: p.head.ref, author: p.user?.login ?? null, url: p.html_url, occurredAt: new Date(p.created_at) })),
    ...branches.map((b) => ({ kind: "branch" as const, repo, ref: b.name, title: b.name, author: null, url: `https://github.com/${repo}/tree/${encodeURIComponent(b.name)}`, occurredAt: now })),
  ];
}

/** Offline sample activity for the seeded demo repository. */
export function demoGithubActivity(repo: string): GithubItem[] {
  const ago = (days: number) => new Date(Date.now() - days * 86_400_000);
  const url = (path: string) => `https://github.com/${repo}/${path}`;
  return [
    { kind: "pull_request", repo, ref: "84", title: "CARR-184 Bulk rate import from CSV", branch: "feature/CARR-184-bulk-rate-import", author: "mia-chen", url: url("pull/84"), occurredAt: ago(5) },
    { kind: "commit", repo, ref: "a3fd17c9e2", title: "CARR-184 Parse rate cards and preview changes", author: "mia-chen", url: url("commit/a3fd17c9e2"), occurredAt: ago(6) },
    { kind: "commit", repo, ref: "94ac1207b1", title: "CARR-184 Add duplicate-lane and formatting tests", author: "mia-chen", url: url("commit/94ac1207b1"), occurredAt: ago(5) },
    { kind: "branch", repo, ref: "feature/CARR-184-bulk-rate-import", title: "feature/CARR-184-bulk-rate-import", author: null, url: url("tree/feature/CARR-184-bulk-rate-import"), occurredAt: ago(7) },
    { kind: "commit", repo, ref: "5be01d2c44", title: "T-108 SLA alert prototype skeleton", author: "jo-osei", url: url("commit/5be01d2c44"), occurredAt: ago(2) },
    { kind: "commit", repo, ref: "77e9a10f03", title: "chore: bump dependencies", author: "jo-osei", url: url("commit/77e9a10f03"), occurredAt: ago(1) },
  ];
}

/** Ticket keys (local T-107 or Jira CARR-184) mentioned in a commit message, branch name or PR title. */
export function findTicketKeys(item: GithubItem, keys: string[]): string[] {
  if (!keys.length) return [];
  const escaped = keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(?<![A-Za-z0-9])(${escaped.join("|")})(?![0-9])`, "gi");
  const text = `${item.title} ${item.branch ?? ""}`;
  return [...new Set([...text.matchAll(re)].map((m) => m[1].toUpperCase()))];
}
