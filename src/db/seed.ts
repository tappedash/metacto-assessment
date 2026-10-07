import { and, eq, inArray, sql } from "drizzle-orm";
import { loadEnv } from "@/lib/env-loader";
import { getAi } from "@/ai";
import { closeDb, getDb } from "./client";
import { createDefaultWorkflow, DEFAULT_WORKFLOW, projectWorkflow } from "@/domain/workflow";
import * as s from "./schema";
import { importGithubActivity } from "@/domain/integrations";
import { demoGithubActivity } from "@/integrations/github";

// Demo data mirroring the prototypes: two staffed clients, four projects, five
// Customer Needs with verbatim Feature Requests, and delivery tickets.
// Re-runnable: truncates every table first.

const NEEDS = {
  export: {
    title: "Use product data outside the platform",
    problemStatement: "Operations and finance teams need to use shipment and report data in their own tools because they reconcile and report weekly outside the platform; today they copy numbers by hand.",
    status: "under_review" as const,
  },
  sso: {
    title: "Sign in with company identity",
    problemStatement: "IT teams need to manage access with their corporate identity provider instead of separate passwords.",
    status: "in_development" as const, priority: "P1" as const,
    publicRationale: "Enterprise security requirement; SAML first.",
  },
  dark: {
    title: "Dark mode for the dashboard",
    problemStatement: "Users want a dark theme for long sessions in the dashboard.",
    status: "not_planned" as const,
    publicRationale: "Popular, but we're focusing on reporting and security needs that block daily work.",
  },
  delays: {
    title: "Know about delays before customers do",
    problemStatement: "Operations teams need early warning when shipments slip past their SLA so they can act before customers complain.",
    status: "under_review" as const,
  },
  rates: {
    title: "Update many carrier rates at once",
    problemStatement: "Operations teams need to update many carrier rates at once because rate cards change quarterly; today they edit each lane manually.",
    status: "released" as const, priority: "P2" as const,
    publicRationale: "Quarterly rate changes take days of manual edits; a CSV import removes that work.",
  },
};
type NeedKey = keyof typeof NEEDS;

/** Resets every table and loads the demo data. Used by `npm run db:seed` and integration tests. */
export async function seed({ quiet = false } = {}) {
  loadEnv();
  const db = getDb();
  const { embeddings } = getAi();
  if (!quiet) console.log(`Seeding with AI_PROVIDER embeddings: ${embeddings.provider} (${embeddings.model})`);

  await db.execute(sql`TRUNCATE accounts, users, staffing, strategic_goals, needs, requests, supports,
    decisions, status_updates, projects, project_statuses, project_members, tickets, attachments,
    invitations, auth_sessions, auth_accounts, auth_verifications, ticket_events, ticket_validations,
    notifications, project_integrations, github_activity, workspace_settings RESTART IDENTITY CASCADE`);
  await db.insert(s.workspaceSettings).values({ id: 1, customerNotify: { planned: true, in_development: true, ready_for_review: true, released: true, rework_decision: true } });

  const [northwind, contoso, fabrikam, tailspin, alpine, bluebird, cedar] = await db.insert(s.accounts).values([
    { name: "Northwind Logistics", tier: "Mid-market", segment: "Logistics", contractValue: 420_000 },
    { name: "Contoso Health", tier: "Enterprise", segment: "Healthcare", contractValue: 1_200_000 },
    { name: "Fabrikam Retail", tier: "Enterprise", segment: "Retail", contractValue: 980_000 },
    { name: "Tailspin Air", type: "prospect", tier: "Enterprise", segment: "Aviation" },
    { name: "Alpine Outfitters", tier: "SMB", segment: "Retail", contractValue: 60_000 },
    { name: "Bluebird Couriers", tier: "SMB", segment: "Logistics", contractValue: 45_000 },
    { name: "Cedar Clinics", tier: "Mid-market", segment: "Healthcare", contractValue: 150_000 },
  ]).returning();

  const [alex, sam, ravi, mia, jo, lena, dana, omar] = await db.insert(s.users).values([
    { name: "Alex Lee", email: "alex@needs-hub.local", role: "admin" },
    { name: "Sam Kim", email: "sam@needs-hub.local", role: "pm" },
    { name: "Ravi Patel", email: "ravi@needs-hub.local", role: "engineer" },
    { name: "Mia Chen", email: "mia@needs-hub.local", role: "engineer" },
    { name: "Jo Osei", email: "jo@needs-hub.local", role: "engineer" },
    { name: "Lena Meyer", email: "lena@northwind.example", role: "client", accountId: northwind.id },
    { name: "Dana Ruiz", email: "dana@contoso.example", role: "client", accountId: contoso.id },
    { name: "Omar Haddad", email: "omar@fabrikam.example", role: "client", accountId: fabrikam.id },
  ]).returning();
  const [ana, ben, cara, dev] = await db.insert(s.users).values([
    { name: "Ana Torres", email: "ana@alpine.example", role: "client", accountId: alpine.id },
    { name: "Ben Okafor", email: "ben@bluebird.example", role: "client", accountId: bluebird.id },
    { name: "Cara Lind", email: "cara@cedar.example", role: "client", accountId: cedar.id },
    { name: "Dev Shah", email: "dev@fabrikam.example", role: "client", accountId: fabrikam.id },
  ]).returning();
  // Seeded people already have access (as if they accepted an invitation); sign in with a magic link.
  await db.update(s.users).set({ emailVerified: true });
  // One pending invitation to demo first sign-in: role and client account come from it.
  await db.insert(s.invitations).values({ email: "maya@cedar.example", name: "Maya Ito", role: "client", accountId: cedar.id, invitedBy: alex.id });

  await db.insert(s.staffing).values([
    { engineerId: ravi.id, accountId: northwind.id },
    { engineerId: ravi.id, accountId: contoso.id },
    { engineerId: mia.id, accountId: northwind.id },
    { engineerId: mia.id, accountId: fabrikam.id },
    { engineerId: jo.id, accountId: contoso.id },
  ]);

  await db.insert(s.strategicGoals).values([
    { code: "G1", text: "Reduce delivery effort on legacy migrations" },
    { code: "G2", text: "Expand in enterprise logistics accounts" },
    { code: "G3", text: "Meet enterprise security requirements" },
  ]);

  // Customer Needs, embedded from title + problem statement.
  const keys = Object.keys(NEEDS) as NeedKey[];
  const needVectors = await embeddings.embed(keys.map((k) => `${NEEDS[k].title}\n${NEEDS[k].problemStatement}`));
  const needRows = await db.insert(s.needs).values(keys.map((k, i) => ({ ...NEEDS[k], embedding: needVectors[i], ownerId: sam.id }))).returning();
  const need = Object.fromEntries(keys.map((k, i) => [k, needRows[i]])) as Record<NeedKey, (typeof needRows)[number]>;

  // Verbatim Feature Requests (evidence), linked and confirmed.
  // daysAgo spreads requests over 60 days so the 30-day demand trend is meaningful.
  const REQUESTS: { title: string; why: string; account: typeof northwind; by: typeof lena; need: NeedKey; onBehalf?: boolean; link: "same" | "related"; daysAgo?: number }[] = [
    { title: "Export dashboard to Excel", why: "Our finance team reconciles shipping costs every Monday in their own spreadsheets. Today I copy numbers by hand.", account: northwind, by: lena, need: "export", link: "same" },
    { title: "CSV download of all orders", why: "We join it with ERP data for month-end close.", account: fabrikam, by: omar, need: "export", link: "same", daysAgo: 45 },
    { title: "Push weekly KPIs into Power BI", why: "Leadership reviews KPIs in Power BI; an analyst rebuilds them every Monday.", account: contoso, by: ravi, need: "export", onBehalf: true, link: "related" },
    { title: "SAML login for our admin console", why: "Security review requires central offboarding.", account: contoso, by: dana, need: "sso", link: "same" },
    { title: "Provision users from Okta", why: "IT spends hours creating accounts by hand.", account: contoso, by: jo, need: "sso", onBehalf: true, link: "related" },
    { title: "Dark mode for the dashboard", why: "Easier on the eyes during night shifts.", account: northwind, by: lena, need: "dark", link: "same", daysAgo: 50 },
    { title: "Night theme for the dashboard", why: "Our dispatchers work late and the white screen is harsh.", account: alpine, by: ana, need: "dark", link: "same" },
    { title: "Dark mode", why: "Matches the rest of our tools.", account: bluebird, by: ben, need: "dark", link: "same" },
    { title: "Darker colour scheme", why: "Staff on night shifts find it easier to read.", account: cedar, by: cara, need: "dark", link: "same" },
    { title: "SSO with Azure AD", why: "Our security policy requires central offboarding for every vendor.", account: fabrikam, by: dev, need: "sso", link: "same" },
    { title: "Alert us when a shipment misses its SLA", why: "We hear about delays from customers first.", account: northwind, by: lena, need: "delays", link: "same" },
    { title: "Bulk edit carrier rates", why: "Rates change quarterly for 200+ lanes and we update them one by one.", account: northwind, by: lena, need: "rates", link: "same" },
  ];
  const requestVectors = await embeddings.embed(REQUESTS.map((r) => `${r.title}\n${r.why}`));
  await db.insert(s.requests).values(REQUESTS.map((r, i) => ({
    title: r.title, why: r.why, accountId: r.account.id, submittedBy: r.by.id, onBehalf: r.onBehalf ?? false,
    needId: need[r.need].id, linkType: r.link, linkConfidence: r.link === "same" ? 0.92 : 0.64,
    linkReason: "Seeded demo link", linkState: "confirmed" as const, embedding: requestVectors[i],
    createdAt: new Date(Date.now() - (r.daysAgo ?? 5) * 86_400_000),
  })));

  // One borderline request waiting in PM Triage: related to "export", below the confidence threshold.
  const triageWhy = "Our external auditors want the shipment audit report emailed to them every month; they don't have logins.";
  const [triageVector] = await embeddings.embed([`Monthly audit report by email\n${triageWhy}`]);
  await db.insert(s.requests).values({
    title: "Monthly audit report by email", why: triageWhy, accountId: contoso.id, submittedBy: dana.id,
    needId: need.export.id, linkType: "related", linkConfidence: 0.55, linkState: "triage" as const, embedding: triageVector,
    linkReason: `Overlaps with "${need.export.title}", but below the confidence threshold.`, createdAt: new Date(Date.now() - 86_400_000),
  });

  await db.insert(s.supports).values([
    { userId: lena.id, needId: need.export.id },
    { userId: omar.id, needId: need.export.id },
    { userId: dana.id, needId: need.sso.id },
    { userId: lena.id, needId: need.dark.id },
    { userId: ana.id, needId: need.dark.id },
    { userId: ben.id, needId: need.dark.id },
    { userId: cara.id, needId: need.dark.id },
    { userId: dev.id, needId: need.sso.id },
    { userId: lena.id, needId: need.delays.id },
  ]);

  // Delivery: Client -> Project -> Ticket (tickets link to the Need that explains "why").
  const [rm, ca, im, cr] = await db.insert(s.projects).values([
    { accountId: northwind.id, name: "Reporting Modernization", status: "active" },
    { accountId: northwind.id, name: "Carrier Automation", status: "active" },
    { accountId: contoso.id, name: "Identity Modernization", status: "active" },
    { accountId: contoso.id, name: "Compliance Reporting", status: "planning" },
  ]).returning();
  // Ticket workflows are configured per project. Two show custom flows; the rest use the default.
  await createDefaultWorkflow(db, rm.id, [
    { name: "Backlog", stage: "backlog" }, { name: "Planned", stage: "planned" },
    { name: "In Development", stage: "in_progress" }, { name: "In QA", stage: "in_progress" }, { name: "Released", stage: "done" },
  ]);
  await createDefaultWorkflow(db, im.id, [
    { name: "Backlog", stage: "backlog" }, { name: "Planned", stage: "planned" }, { name: "Build", stage: "in_progress" },
    { name: "Security review", stage: "in_progress" }, { name: "UAT", stage: "in_progress" },
    { name: "Client sign-off", stage: "in_progress" }, { name: "Live", stage: "done" },
  ]);
  // Customers see UAT and client sign-off as "Ready for Review"; internal names stay internal.
  await db.update(s.projectStatuses).set({ publicStatus: "ready_for_review" })
    .where(and(eq(s.projectStatuses.projectId, im.id), inArray(s.projectStatuses.name, ["UAT", "Client sign-off"])));
  await createDefaultWorkflow(db, ca.id, DEFAULT_WORKFLOW);
  await createDefaultWorkflow(db, cr.id, DEFAULT_WORKFLOW);
  const statusIds = new Map<string, string>();
  for (const p of [rm, ca, im, cr]) for (const st of await projectWorkflow(p.id)) statusIds.set(`${p.id}:${st.name}`, st.id);
  const status = (projectId: string, name: string) => statusIds.get(`${projectId}:${name}`)!;

  await db.insert(s.projectMembers).values([
    { projectId: rm.id, userId: ravi.id }, { projectId: rm.id, userId: mia.id },
    { projectId: ca.id, userId: mia.id }, { projectId: ca.id, userId: jo.id },
    { projectId: im.id, userId: ravi.id }, { projectId: im.id, userId: jo.id },
    { projectId: cr.id, userId: ravi.id },
  ]);
  await db.insert(s.tickets).values([
    { key: "T-101", projectId: rm.id, needId: need.export.id, title: "CSV export for dashboard reports", statusId: status(rm.id, "Planned"), priority: "P1", effort: "M", assigneeId: ravi.id },
    { key: "T-102", projectId: rm.id, needId: need.export.id, title: "Google Sheets connector spike", statusId: status(rm.id, "Backlog"), priority: "P2", effort: "L", assigneeId: mia.id },
    { key: "T-103", projectId: cr.id, needId: need.export.id, title: "Monthly shipment report CSV for audits", statusId: status(cr.id, "In Development"), priority: "P1", effort: "S", assigneeId: ravi.id },
    { key: "T-104", projectId: im.id, needId: need.sso.id, title: "SAML SSO for the admin console", statusId: status(im.id, "Security review"), priority: "P1", effort: "L", assigneeId: ravi.id },
    { key: "T-105", projectId: im.id, needId: need.sso.id, title: "Okta SCIM user provisioning", statusId: status(im.id, "Backlog"), priority: "P2", effort: "M", assigneeId: jo.id },
    { key: "T-106", projectId: cr.id, needId: need.export.id, title: "Audit log export", statusId: status(cr.id, "Released"), priority: "P2", effort: "S", assigneeId: ravi.id },
    { key: "T-107", projectId: ca.id, needId: need.rates.id, title: "Bulk rate import from CSV", statusId: status(ca.id, "Released"), priority: "P2", effort: "M", assigneeId: mia.id },
    { key: "T-108", projectId: ca.id, needId: need.delays.id, title: "SLA breach alert prototype", statusId: status(ca.id, "Backlog"), priority: "P3", effort: "S", assigneeId: jo.id },
  ]);

  await db.insert(s.statusUpdates).values({
    needId: need.sso.id, status: "in_development", subject: "SSO is in development: SAML first",
    body: "We're building SAML sign-in for the admin console first; OIDC follows.", approvedBy: sam.id, sentAt: new Date(),
  });

  // Ticket timelines: status moves (customer-visible when the public status changes) and
  // contributor updates, some shared with customers, some internal only.
  const ticketRows = await db.select({ id: s.tickets.id, key: s.tickets.key, projectId: s.tickets.projectId }).from(s.tickets);
  const tid = (key: string) => ticketRows.find((t) => t.key === key)!;
  const ago = (days: number) => new Date(Date.now() - days * 86_400_000);
  const pub: Record<string, "planned" | "in_development" | "ready_for_review" | "released" | null> = {
    Backlog: null, Planned: "planned", "In Development": "in_development", "In QA": "in_development", Build: "in_development",
    "Security review": "in_development", UAT: "ready_for_review", "Client sign-off": "ready_for_review", Released: "released", Live: "released",
  };
  const moves = (key: string, by: { id: string }, steps: [string, string, number][]) =>
    steps.map(([from, to, days]) => ({
      ticketId: tid(key).id, kind: "status" as const, authorId: by.id, fromStatus: from, toStatus: to, publicStatus: pub[to],
      visibility: pub[to] && pub[to] !== pub[from] ? ("customer" as const) : ("internal" as const), createdAt: ago(days),
      publishedAt: pub[to] && pub[to] !== pub[from] ? ago(days) : null,
    }));
  // Customer-visible notes are published unless `pending` (an engineer's update awaiting PM approval).
  const note = (key: string, by: { id: string }, visibility: "internal" | "customer", body: string, days: number, pending = false) =>
    ({ ticketId: tid(key).id, kind: "comment" as const, authorId: by.id, visibility, body, createdAt: ago(days), publishedAt: visibility === "customer" && !pending ? ago(days) : null });
  await db.insert(s.ticketEvents).values([
    ...moves("T-101", sam, [["Backlog", "Planned", 6]]),
    note("T-101", sam, "customer", "We're starting with CSV export for every dashboard report; a Google Sheets connection comes after.", 5),
    note("T-101", ravi, "internal", "Report query p95 is ~4s on large accounts; add pagination before export.", 2),
    ...moves("T-103", sam, [["Backlog", "Planned", 12]]), ...moves("T-103", ravi, [["Planned", "In Development", 4]]),
    note("T-103", ravi, "customer", "The monthly CSV now covers every shipment field your auditors listed; we expect it in UAT next week.", 1, true),
    ...moves("T-104", sam, [["Backlog", "Planned", 30]]), ...moves("T-104", ravi, [["Planned", "Build", 21], ["Build", "Security review", 3]]),
    note("T-104", ravi, "internal", "Pen-test finding on assertion replay; fix before UAT.", 2),
    ...moves("T-106", sam, [["Backlog", "Planned", 40]]), ...moves("T-106", ravi, [["Planned", "In Development", 30], ["In Development", "Released", 8]]),
    ...moves("T-107", sam, [["Backlog", "Planned", 24]]),
    ...moves("T-107", mia, [["Planned", "In Development", 16], ["In Development", "Released", 3]]),
    note("T-107", mia, "internal", "Validated with 240 lanes from Northwind's Q3 rate card; feature flag rate_import on.", 4),
    note("T-107", sam, "customer", "Bulk rate import is live: Rates → Import CSV. Upload your rate card and review the changes before applying.", 3),
  ]);
  await db.insert(s.statusUpdates).values({
    needId: need.rates.id, status: "released", subject: "Released: bulk carrier rate import",
    body: "You can now import a whole rate card from CSV (Rates → Import CSV) and review changes before applying them.", approvedBy: sam.id, sentAt: ago(3),
  });

  // Optional integrations, offline demo mode: Carrier Automation is linked to Jira and GitHub.
  // Every other project uses local Needs Hub tickets only.
  await db.insert(s.projectIntegrations).values([
    { projectId: ca.id, kind: "jira", config: { siteUrl: "https://northwind-demo.atlassian.net", projectKey: "CARR", email: "", issueType: "Task", demo: true }, lastSyncAt: ago(1) },
    { projectId: ca.id, kind: "github", config: { repos: ["northwind/carrier-rates"], demo: true }, lastSyncAt: ago(1) },
  ]);
  await db.update(s.tickets).set({ externalKey: "CARR-184", externalUrl: "https://northwind-demo.atlassian.net/browse/CARR-184", externalStatus: "Done", externalAssignee: "Mia Chen", syncedAt: ago(1) })
    .where(eq(s.tickets.key, "T-107"));
  await importGithubActivity(ca.id, demoGithubActivity("northwind/carrier-rates"));

  if (!quiet) console.log(`Seeded ${needRows.length} Customer Needs, ${REQUESTS.length + 1} Feature Requests (1 in Triage), 4 projects, 8 tickets.`);
}

// Run directly: `tsx src/db/seed.ts`.
if (process.argv[1]?.endsWith("seed.ts")) {
  seed()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(closeDb);
}
