import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { seed } from "@/db/seed";
import { accounts, invitations, notifications, projectMembers, projects, requests, staffing, supports, users } from "@/db/schema";
import { createProject, setProjectEngineer, setStaffing, setUserActive, setUserRole, updateProject } from "@/domain/admin";
import { checkFeedback } from "@/domain/feedback";
import { canSignIn, inviteUser, resendInvitation } from "@/domain/invitations";
import { notify } from "@/domain/notifications";
import { loadActor, type SessionActor } from "@/domain/session";
import { getSettings, updateSettings } from "@/domain/settings";
import { assignNeedOwner, splitNeed } from "@/domain/triage";
import { projectWorkflow } from "@/domain/workflow";

// Admin configuration (fixed roles, accounts, projects, staffing, defaults) and PM controls.
let alex: SessionActor, sam: SessionActor, jo: SessionActor;
const db = () => getDb();
const userId = async (email: string) => (await db().select({ id: users.id }).from(users).where(eq(users.email, email)))[0].id;

beforeAll(async () => {
  await seed({ quiet: true });
  [alex, sam, jo] = await Promise.all(["alex@needs-hub.local", "sam@needs-hub.local", "jo@needs-hub.local"].map(async (e) => (await loadActor(await userId(e)))!));
});
afterAll(closeDb);

describe("admin configuration", () => {
  it("only the Admin manages users, projects and settings", async () => {
    await expect(setUserActive(sam, jo.id, false)).rejects.toThrow(/Workspace Admin/);
    await expect(createProject(sam, { name: "X", accountId: jo.id, status: "active" })).rejects.toThrow(/Workspace Admin/);
    await expect(updateSettings(sam, await getSettings())).rejects.toThrow(/Workspace Admin/);
  });

  it("deactivated users can't sign in, are signed out and get no notifications", async () => {
    const omar = await userId("omar@fabrikam.example");
    await setUserActive(alex, omar, false);
    expect(await loadActor(omar)).toBeNull();
    expect(await canSignIn("omar@fabrikam.example")).toBe(false);
    const result = await notify({ event: "need.update_published", entity: { type: "need", id: omar }, recipients: [omar], title: "t", body: "b", href: () => "/" });
    expect(result.notified).toBe(0);
    await setUserActive(alex, omar, true);
    expect(await canSignIn("omar@fabrikam.example")).toBe(true);
    await expect(setUserActive(alex, alex.id, false)).rejects.toThrow(/yourself/);
  });

  it("fixed roles: client users need an account; a former engineer loses client visibility", async () => {
    await expect(setUserRole(alex, jo.id, "client", null)).rejects.toThrow(/client account/);
    await setUserRole(alex, jo.id, "pm");
    expect(await db().select().from(staffing).where(eq(staffing.engineerId, jo.id))).toEqual([]);
    await setUserRole(alex, jo.id, "engineer");
  });

  it("resends a pending invitation", async () => {
    await inviteUser(alex, { name: "Kai", email: "kai@northwind.example", role: "client", accountId: (await db().select().from(accounts).where(eq(accounts.name, "Northwind Logistics")))[0].id });
    const [inv] = await db().select().from(invitations).where(eq(invitations.email, "kai@northwind.example"));
    expect(await resendInvitation(alex, inv.id)).toBe("kai@northwind.example");
  });

  it("projects start with the default workflow; staffing is Engineer -> Account -> Project", async () => {
    const [northwind] = await db().select().from(accounts).where(eq(accounts.name, "Northwind Logistics"));
    await createProject(alex, { name: "Driver App", accountId: northwind.id, status: "planning" });
    const [project] = await db().select().from(projects).where(eq(projects.name, "Driver App"));
    expect((await projectWorkflow(project.id)).map((s) => s.name)).toEqual(["Backlog", "Planned", "In Development", "Released"]);

    const joNow = (await loadActor(jo.id))!;
    expect(joNow.staffedAccountIds).not.toContain(northwind.id);
    await setProjectEngineer(alex, project.id, jo.id, true);
    expect((await loadActor(jo.id))!.staffedAccountIds).toContain(northwind.id); // visibility follows
    const [n] = await db().select().from(notifications).where(and(eq(notifications.userId, jo.id), eq(notifications.eventType, "project.staffed"), eq(notifications.channel, "in_app")));
    expect(n.title).toBe("You're staffed on Driver App");

    // Removing the account staffing also removes them from its projects.
    await setStaffing(alex, jo.id, northwind.id, false);
    expect(await db().select().from(projectMembers).where(eq(projectMembers.userId, jo.id))).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ projectId: project.id })]));

    // A project with tickets can't move to another client.
    const [carrier] = await db().select().from(projects).where(eq(projects.name, "Carrier Automation"));
    const [contoso] = await db().select().from(accounts).where(eq(accounts.name, "Contoso Health"));
    await expect(updateProject(alex, carrier.id, { name: carrier.name, accountId: contoso.id, status: "active" })).rejects.toThrow(/tickets/);
  });

  it("matches below the Admin's threshold aren't suggested (they go to Triage)", async () => {
    const input = { title: "Export dashboard to Excel", why: "Finance reconciles shipping costs in spreadsheets every Monday." };
    const before = await checkFeedback(input, { skipFollowUp: true });
    expect(before.kind === "match" && before.match.need).toBeTruthy();
    const settings = await getSettings();
    await updateSettings(alex, { ...settings, matchThreshold: 0.95 });
    const after = await checkFeedback(input, { skipFollowUp: true });
    expect(after.kind === "match" && after.match.need).toBeNull();
    await updateSettings(alex, settings);
  });
});

describe("PM controls", () => {
  it("assigns a Need owner, who is notified", async () => {
    const [{ needId }] = await db().select({ needId: requests.needId }).from(requests).where(eq(requests.title, "Dark mode"));
    const pat = (await db().insert(users).values({ name: "Pat PM", email: "pat2@needs-hub.local", role: "pm" }).returning())[0];
    await assignNeedOwner(sam, needId!, pat.id);
    const [n] = await db().select().from(notifications).where(and(eq(notifications.userId, pat.id), eq(notifications.channel, "in_app")));
    expect(n.eventType).toBe("need.assigned");
    await expect(assignNeedOwner(sam, needId!, jo.id)).rejects.toThrow(/Product Manager/);
  });

  it("splits requests into a new Need; their client submitters follow the new one", async () => {
    const [nightTheme] = await db().select().from(requests).where(eq(requests.title, "Night theme for the dashboard"));
    const oldNeed = nightTheme.needId!;
    const newId = await splitNeed(sam, oldNeed, [nightTheme.id], "Readable dashboards on night shifts");
    expect((await db().select().from(requests).where(eq(requests.id, nightTheme.id)))[0].needId).toBe(newId);
    const followers = async (needId: string) => (await db().select().from(supports).where(eq(supports.needId, needId))).map((s) => s.userId);
    expect(await followers(newId)).toEqual([nightTheme.submittedBy]);
    expect(await followers(oldNeed)).not.toContain(nightTheme.submittedBy);
    await expect(splitNeed(jo, oldNeed, [nightTheme.id], "")).rejects.toThrow(/Product Manager/);
  });
});
