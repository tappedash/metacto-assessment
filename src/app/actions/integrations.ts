"use server";

import { revalidatePath } from "next/cache";
import { disconnect, linkJiraIssue, saveGithub, saveJira, syncGithub, syncJira } from "@/domain/integrations";
import { requireActor } from "@/domain/session";
import { str, withFlash } from "@/lib/flash";

// Project -> Integrations (Admin or PM). `back` is the page to return to.
const refresh = () => revalidatePath("/", "layout");
const safeBack = (back: string) => (/^\/(admin|pm)\//.test(back) ? back : "/pm/projects");

export async function saveJiraAction(projectId: string, back: string, form: FormData) {
  const actor = await requireActor(["admin", "pm"]);
  await withFlash(safeBack(back), async () => {
    await saveJira(actor, projectId, {
      siteUrl: str(form, "siteUrl"), projectKey: str(form, "projectKey"), email: str(form, "email"), issueType: str(form, "issueType"),
      demo: form.get("demo") === "on", enabled: form.get("enabled") === "on", token: str(form, "token"),
    });
    refresh();
    return "Jira connection saved.";
  });
}

export async function saveGithubAction(projectId: string, back: string, form: FormData) {
  const actor = await requireActor(["admin", "pm"]);
  await withFlash(safeBack(back), async () => {
    await saveGithub(actor, projectId, { repos: str(form, "repos"), demo: form.get("demo") === "on", enabled: form.get("enabled") === "on", token: str(form, "token") });
    refresh();
    return "GitHub repositories saved.";
  });
}

export async function syncAction(projectId: string, kind: "jira" | "github", back: string) {
  const actor = await requireActor(["admin", "pm"]);
  await withFlash(safeBack(back), async () => {
    const n = kind === "jira" ? await syncJira(actor, projectId) : await syncGithub(actor, projectId);
    refresh();
    return kind === "jira" ? `Synced ${n} linked Jira issue${n === 1 ? "" : "s"}.` : `Read ${n} GitHub item${n === 1 ? "" : "s"} and linked them to tickets.`;
  });
}

export async function disconnectAction(projectId: string, kind: "jira" | "github", back: string) {
  const actor = await requireActor(["admin", "pm"]);
  await withFlash(safeBack(back), async () => {
    await disconnect(actor, projectId, kind);
    refresh();
    return `${kind === "jira" ? "Jira" : "GitHub"} disconnected. Needs Hub tickets keep working locally.`;
  });
}

export async function linkJiraAction(ticketId: string) {
  const actor = await requireActor(["pm"]);
  await withFlash(`/pm/tickets/${ticketId}`, async () => { await linkJiraIssue(actor, ticketId); refresh(); return "Jira issue created and linked."; });
}
