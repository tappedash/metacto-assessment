import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { seed } from "@/db/seed";
import { projectIntegrations, projects, tickets, users } from "@/db/schema";
import { disconnect, linkJiraIssue, projectActivity, saveGithub, saveJira, syncGithub, syncJira, ticketActivity, ticketConnector } from "@/domain/integrations";
import { loadActor, type SessionActor } from "@/domain/session";
import { customerActivity, customerTicket } from "@/domain/tracking";
import { fetchGithubActivity, findTicketKeys } from "@/integrations/github";
import { jiraConnector } from "@/integrations/jira";
import { decryptSecret, encryptSecret } from "@/lib/secrets";

// Optional Jira / GitHub. Local tickets work without them; their data never reaches customers.
let sam: SessionActor, ravi: SessionActor, jo: SessionActor, lena: SessionActor;
let carrier: string, reporting: string;
const db = () => getDb();

beforeAll(async () => {
  await seed({ quiet: true });
  const actor = async (email: string) => (await loadActor((await db().select({ id: users.id }).from(users).where(eq(users.email, email)))[0].id))!;
  [sam, ravi, jo, lena] = await Promise.all(["sam@needs-hub.local", "ravi@needs-hub.local", "jo@needs-hub.local", "lena@northwind.example"].map(actor));
  const project = async (name: string) => (await db().select().from(projects).where(eq(projects.name, name)))[0].id;
  [carrier, reporting] = [await project("Carrier Automation"), await project("Reporting Modernization")];
});
afterAll(closeDb);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("connectors", () => {
  it("projects without Jira use the local connector", async () => {
    expect((await ticketConnector(reporting)).kind).toBe("local");
    expect((await ticketConnector(carrier)).kind).toBe("jira");
  });

  it("live Jira: creates an issue and reads status/assignee (REST v3, basic auth)", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === "POST") return json({ key: "PROJ-7" });
      return json({ fields: { status: { name: "Blocked" }, assignee: { displayName: "Ravi Patel" } } });
    }) as typeof fetch;
    const jira = jiraConnector({ siteUrl: "https://acme.atlassian.net", projectKey: "PROJ", email: "pm@acme.test", issueType: "Task", demo: false }, "tok", fake);
    const issue = await jira.createIssue({ key: "T-101", title: "CSV export", needTitle: "Use data outside", link: "http://x", local: { status: "Planned", stage: "planned", assignee: null } });
    expect(issue).toEqual({ key: "PROJ-7", url: "https://acme.atlassian.net/browse/PROJ-7", status: "Blocked", assignee: "Ravi Patel" });
    expect(calls[0].url).toBe("https://acme.atlassian.net/rest/api/3/issue");
    expect((calls[0].init!.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("pm@acme.test:tok").toString("base64")}`);
    expect(JSON.parse(String(calls[0].init!.body)).fields.project.key).toBe("PROJ");
    expect(await jira.fetchIssue({ externalKey: "PROJ-7", local: { status: "", stage: "", assignee: null } })).toEqual({ status: "Blocked", assignee: "Ravi Patel", blocked: true });
  });

  it("live GitHub: reads commits, PRs and branches; keys match in messages, branch names and PR titles", async () => {
    const fake = (async (url: string) => {
      if (url.endsWith("/commits?per_page=50")) return json([{ sha: "a3fd17c000", html_url: "u1", commit: { message: "PROJ-184 add CSV export\n\nbody", author: { name: "Mia", date: "2026-10-01T00:00:00Z" } }, author: { login: "mia" } }]);
      if (url.includes("/pulls")) return json([{ number: 84, title: "Add CSV export", html_url: "u2", created_at: "2026-10-02T00:00:00Z", user: { login: "mia" }, head: { ref: "feature/PROJ-184-csv-export" } }]);
      return json([{ name: "feature/PROJ-184-csv-export" }]);
    }) as typeof fetch;
    const items = await fetchGithubActivity("company/reporting-api", null, fake);
    expect(items.map((i) => [i.kind, i.ref, findTicketKeys(i, ["PROJ-184", "T-101"])])).toEqual([
      ["commit", "a3fd17c000", ["PROJ-184"]],
      ["pull_request", "84", ["PROJ-184"]], // via its branch name
      ["branch", "feature/PROJ-184-csv-export", ["PROJ-184"]],
    ]);
    expect(findTicketKeys({ ...items[0], title: "PROJ-1840 unrelated" }, ["PROJ-184"])).toEqual([]);
  });

  it("stores tokens encrypted", () => {
    const stored = encryptSecret("ghp_secret");
    expect(stored).not.toContain("ghp_secret");
    expect(decryptSecret(stored)).toBe("ghp_secret");
  });
});

describe("project integrations", () => {
  it("only the Admin or PM configures; validation keeps input sane", async () => {
    await expect(saveGithub(ravi, reporting, { repos: "a/b", enabled: true, demo: true, token: "" })).rejects.toThrow(/Admin or the PM/);
    await expect(saveJira(sam, reporting, { siteUrl: "http://x", projectKey: "R", email: "", issueType: "", demo: true, enabled: true, token: "" })).rejects.toThrow(/Jira site/);
    await saveGithub(sam, reporting, { repos: "https://github.com/northwind/reporting-api\nnorthwind/reporting-web", enabled: true, demo: true, token: "ghp_x" });
    const [row] = await db().select().from(projectIntegrations).where(eq(projectIntegrations.projectId, reporting));
    expect(row.config).toEqual({ repos: ["northwind/reporting-api", "northwind/reporting-web"], demo: true });
    expect(row.secret).not.toContain("ghp_x");
    await disconnect(sam, reporting, "github");
  });

  it("PM links a ticket to Jira (demo mode) and syncs it", async () => {
    const [t108] = await db().select().from(tickets).where(eq(tickets.key, "T-108"));
    await linkJiraIssue(sam, t108.id);
    const [linked] = await db().select().from(tickets).where(eq(tickets.id, t108.id));
    expect(linked.externalKey).toBe("CARR-185");
    expect(linked.externalStatus).toBe("Backlog");
    await expect(linkJiraIssue(sam, t108.id)).rejects.toThrow(/Already linked/);
    expect(await syncJira(sam, carrier)).toBe(2);
    const [t101] = await db().select().from(tickets).where(eq(tickets.key, "T-101"));
    await expect(linkJiraIssue(sam, t101.id)).rejects.toThrow(/isn't connected/); // Reporting: local only
  });

  it("GitHub sync links activity to tickets; the team sees it, staffing applies", async () => {
    await syncGithub(sam, carrier);
    const [t107] = await db().select().from(tickets).where(eq(tickets.key, "T-107"));
    expect((await ticketActivity(ravi, t107.id)).map((a) => a.kind).sort()).toEqual(["branch", "commit", "commit", "pull_request"]);
    await expect(projectActivity(jo, carrier)).rejects.toThrow(/not found/); // Jo isn't staffed on Northwind
  });

  it("customers never see Jira or GitHub data", async () => {
    const [t107] = await db().select().from(tickets).where(eq(tickets.key, "T-107"));
    const view = (await customerTicket(lena, t107.id))!;
    const text = JSON.stringify(view) + JSON.stringify(await customerActivity(lena));
    for (const leak of ["CARR-184", "atlassian", "github", "a3fd17c", "Validated with 240 lanes"]) expect(text).not.toContain(leak);
    await expect(projectActivity(lena, carrier)).rejects.toThrow(/not found/);
  });
});
