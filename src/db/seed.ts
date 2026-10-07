import { sql } from "drizzle-orm";
import { loadEnv } from "@/lib/env-loader";
import { getAi } from "@/ai";
import { closeDb, getDb } from "./client";
import * as s from "./schema";

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
    status: "under_review" as const,
  },
};
type NeedKey = keyof typeof NEEDS;

async function main() {
  loadEnv();
  const db = getDb();
  const { embeddings } = getAi();
  console.log(`Seeding with AI_PROVIDER embeddings: ${embeddings.provider} (${embeddings.model})`);

  await db.execute(sql`TRUNCATE accounts, users, staffing, strategic_goals, needs, requests, supports,
    decisions, status_updates, projects, project_members, tickets RESTART IDENTITY CASCADE`);

  const [northwind, contoso, fabrikam, tailspin] = await db.insert(s.accounts).values([
    { name: "Northwind Logistics", tier: "Mid-market", segment: "Logistics", contractValue: 420_000 },
    { name: "Contoso Health", tier: "Enterprise", segment: "Healthcare", contractValue: 1_200_000 },
    { name: "Fabrikam Retail", tier: "Enterprise", segment: "Retail", contractValue: 980_000 },
    { name: "Tailspin Air", type: "prospect", tier: "Enterprise", segment: "Aviation" },
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
  void alex;

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
  const needRows = await db.insert(s.needs).values(keys.map((k, i) => ({ ...NEEDS[k], embedding: needVectors[i] }))).returning();
  const need = Object.fromEntries(keys.map((k, i) => [k, needRows[i]])) as Record<NeedKey, (typeof needRows)[number]>;

  // Verbatim Feature Requests (evidence), linked and confirmed.
  const REQUESTS: { title: string; why: string; account: typeof northwind; by: typeof lena; need: NeedKey; onBehalf?: boolean; link: "same" | "related" }[] = [
    { title: "Export dashboard to Excel", why: "Our finance team reconciles shipping costs every Monday in their own spreadsheets. Today I copy numbers by hand.", account: northwind, by: lena, need: "export", link: "same" },
    { title: "CSV download of all orders", why: "We join it with ERP data for month-end close.", account: fabrikam, by: omar, need: "export", link: "same" },
    { title: "Push weekly KPIs into Power BI", why: "Leadership reviews KPIs in Power BI; an analyst rebuilds them every Monday.", account: contoso, by: ravi, need: "export", onBehalf: true, link: "related" },
    { title: "SAML login for our admin console", why: "Security review requires central offboarding.", account: contoso, by: dana, need: "sso", link: "same" },
    { title: "Provision users from Okta", why: "IT spends hours creating accounts by hand.", account: contoso, by: jo, need: "sso", onBehalf: true, link: "related" },
    { title: "Dark mode please", why: "Easier on the eyes during night shifts.", account: fabrikam, by: omar, need: "dark", link: "same" },
    { title: "Alert us when a shipment misses its SLA", why: "We hear about delays from customers first.", account: northwind, by: lena, need: "delays", link: "same" },
    { title: "Bulk edit carrier rates", why: "Rates change quarterly for 200+ lanes and we update them one by one.", account: northwind, by: lena, need: "rates", link: "same" },
  ];
  const requestVectors = await embeddings.embed(REQUESTS.map((r) => `${r.title}\n${r.why}`));
  await db.insert(s.requests).values(REQUESTS.map((r, i) => ({
    title: r.title, why: r.why, accountId: r.account.id, submittedBy: r.by.id, onBehalf: r.onBehalf ?? false,
    needId: need[r.need].id, linkType: r.link, linkConfidence: r.link === "same" ? 0.92 : 0.64,
    linkReason: "Seeded demo link", linkState: "confirmed" as const, embedding: requestVectors[i],
  })));

  await db.insert(s.supports).values([
    { userId: lena.id, needId: need.export.id },
    { userId: omar.id, needId: need.export.id },
    { userId: dana.id, needId: need.sso.id },
    { userId: omar.id, needId: need.dark.id },
    { userId: lena.id, needId: need.delays.id },
  ]);

  // Delivery: Client -> Project -> Ticket (tickets link to the Need that explains "why").
  const [rm, ca, im, cr] = await db.insert(s.projects).values([
    { accountId: northwind.id, name: "Reporting Modernization", status: "active" },
    { accountId: northwind.id, name: "Carrier Automation", status: "active" },
    { accountId: contoso.id, name: "Identity Modernization", status: "active" },
    { accountId: contoso.id, name: "Compliance Reporting", status: "planning" },
  ]).returning();
  await db.insert(s.projectMembers).values([
    { projectId: rm.id, userId: ravi.id }, { projectId: rm.id, userId: mia.id },
    { projectId: ca.id, userId: mia.id }, { projectId: ca.id, userId: jo.id },
    { projectId: im.id, userId: ravi.id }, { projectId: im.id, userId: jo.id },
    { projectId: cr.id, userId: ravi.id },
  ]);
  await db.insert(s.tickets).values([
    { key: "T-101", projectId: rm.id, needId: need.export.id, title: "CSV export for dashboard reports", status: "planned", priority: "P1", effort: "M", assigneeId: ravi.id },
    { key: "T-102", projectId: rm.id, needId: need.export.id, title: "Google Sheets connector spike", status: "backlog", priority: "P2", effort: "L", assigneeId: mia.id },
    { key: "T-103", projectId: cr.id, needId: need.export.id, title: "Monthly shipment report CSV for audits", status: "in_development", priority: "P1", effort: "S", assigneeId: ravi.id },
    { key: "T-104", projectId: im.id, needId: need.sso.id, title: "SAML SSO for the admin console", status: "in_development", priority: "P1", effort: "L", assigneeId: ravi.id },
    { key: "T-105", projectId: im.id, needId: need.sso.id, title: "Okta SCIM user provisioning", status: "backlog", priority: "P2", effort: "M", assigneeId: jo.id },
    { key: "T-106", projectId: cr.id, needId: need.export.id, title: "Audit log export", status: "released", priority: "P2", effort: "S", assigneeId: ravi.id },
    { key: "T-107", projectId: ca.id, needId: need.rates.id, title: "Bulk rate import from CSV", status: "backlog", priority: "P2", effort: "M", assigneeId: mia.id },
    { key: "T-108", projectId: ca.id, needId: need.delays.id, title: "SLA breach alert prototype", status: "backlog", priority: "P3", effort: "S", assigneeId: jo.id },
  ]);

  await db.insert(s.statusUpdates).values({
    needId: need.sso.id, status: "in_development", subject: "SSO is in development: SAML first",
    body: "We're building SAML sign-in for the admin console first; OIDC follows.", approvedBy: sam.id, sentAt: new Date(),
  });

  console.log(`Seeded ${needRows.length} Customer Needs, ${REQUESTS.length} Feature Requests, 4 projects, 8 tickets.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closeDb);
