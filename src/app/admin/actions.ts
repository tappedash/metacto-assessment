"use server";

import { revalidatePath } from "next/cache";
import { createAccount, createProject, deleteGoal, saveGoal, setProjectEngineer, setStaffing, setUserActive, setUserRole, updateAccount, updateProject, type AccountInput, type ProjectInput } from "@/domain/admin";
import { inviteUser, resendInvitation, revokeInvitation } from "@/domain/invitations";
import { CUSTOMER_NOTIFY_KEYS, updateSettings, type CustomerNotify } from "@/domain/settings";
import type { Role } from "@/domain/permissions";
import { requireActor } from "@/domain/session";
import { str, withFlash } from "@/lib/flash";

const refresh = () => revalidatePath("/", "layout");

function accountInput(form: FormData): AccountInput {
  const value = Number(str(form, "contractValue").replace(/[^0-9]/g, ""));
  return {
    name: str(form, "name"), type: str(form, "type") === "prospect" ? "prospect" : "client",
    tier: str(form, "tier"), segment: str(form, "segment"), contractValue: value > 0 ? value : null, ownerPmId: str(form, "ownerPmId") || null,
  };
}

export async function createAccountAction(form: FormData) {
  const actor = await requireActor(["admin"]);
  await withFlash("/admin/clients", async () => {
    await createAccount(actor, accountInput(form));
    refresh();
    return `${str(form, "name")} onboarded.`;
  });
}

export async function updateAccountAction(id: string, form: FormData) {
  const actor = await requireActor(["admin"]);
  await withFlash("/admin/clients", async () => { await updateAccount(actor, id, accountInput(form)); refresh(); return `${str(form, "name")} saved.`; });
}

export async function inviteCustomerAction(accountId: string, form: FormData) {
  const actor = await requireActor(["admin"]);
  await withFlash("/admin/clients", async () => {
    await inviteUser(actor, { name: str(form, "name"), email: str(form, "email"), role: "client", accountId });
    refresh();
    return `Invitation sent to ${str(form, "email")}.`;
  });
}

// ---------- projects ----------

function projectInput(form: FormData): ProjectInput {
  const status = str(form, "status");
  return { name: str(form, "name"), accountId: str(form, "accountId"), status: status === "planning" || status === "done" ? status : "active" };
}

export async function createProjectAction(form: FormData) {
  const actor = await requireActor(["admin"]);
  await withFlash("/admin/projects", async () => { await createProject(actor, projectInput(form)); refresh(); return `${str(form, "name")} created with the default workflow.`; });
}

export async function updateProjectAction(id: string, form: FormData) {
  const actor = await requireActor(["admin"]);
  await withFlash("/admin/projects", async () => { await updateProject(actor, id, projectInput(form)); refresh(); return `${str(form, "name")} saved.`; });
}

export async function assignEngineerAction(projectId: string, form: FormData) {
  const actor = await requireActor(["admin"]);
  await withFlash("/admin/projects", async () => {
    await setProjectEngineer(actor, projectId, str(form, "engineerId"), true);
    refresh();
    return "Engineer added to the project and staffed on its client.";
  });
}

export async function removeEngineerAction(projectId: string, engineerId: string) {
  const actor = await requireActor(["admin"]);
  await withFlash("/admin/projects", async () => { await setProjectEngineer(actor, projectId, engineerId, false); refresh(); return "Engineer removed from the project."; });
}

// ---------- workspace settings ----------

export async function saveSettingsAction(form: FormData) {
  const actor = await requireActor(["admin"]);
  await withFlash("/admin/settings", async () => {
    const customerNotify = Object.fromEntries(CUSTOMER_NOTIFY_KEYS.map((k) => [k, form.get(`notify_${k}`) === "on"])) as CustomerNotify;
    await updateSettings(actor, {
      matchThreshold: Number(str(form, "matchThreshold")) / 100, customerNotify,
      defaultNotifyEmail: form.get("defaultNotifyEmail") === "on", defaultNotifyInApp: form.get("defaultNotifyInApp") === "on",
    });
    refresh();
    return "Workspace settings saved.";
  });
}

/** Staffing saves on change (no separate Save click). Returns a message for the live region. */
export async function setStaffingAction(engineerId: string, accountId: string, staffed: boolean): Promise<string> {
  const actor = await requireActor(["admin"]);
  try {
    await setStaffing(actor, engineerId, accountId, staffed);
    refresh();
    return staffed ? "Staffing saved: added." : "Staffing saved: removed.";
  } catch (error) {
    return `Not saved: ${(error as Error).message}`;
  }
}

export async function inviteUserAction(form: FormData) {
  const actor = await requireActor(["admin"]);
  await withFlash("/admin/users", async () => {
    await inviteUser(actor, { name: str(form, "name"), email: str(form, "email"), role: str(form, "role") as Role, accountId: str(form, "accountId") || null });
    refresh();
    return `Invitation sent to ${str(form, "email")}. They get access the first time they sign in with that email.`;
  });
}

export async function revokeInvitationAction(id: string) {
  const actor = await requireActor(["admin"]);
  await withFlash("/admin/users", async () => { await revokeInvitation(actor, id); refresh(); return "Invitation revoked."; });
}

export async function setUserRoleAction(userId: string, form: FormData) {
  const actor = await requireActor(["admin"]);
  await withFlash("/admin/users", async () => { await setUserRole(actor, userId, str(form, "role") as Role, str(form, "accountId") || null); refresh(); return "Role updated."; });
}

export async function setUserActiveAction(userId: string, active: boolean) {
  const actor = await requireActor(["admin"]);
  await withFlash("/admin/users", async () => {
    await setUserActive(actor, userId, active);
    refresh();
    return active ? "User reactivated. They can sign in again." : "User deactivated and signed out.";
  });
}

export async function resendInvitationAction(id: string) {
  const actor = await requireActor(["admin"]);
  await withFlash("/admin/users", async () => { const email = await resendInvitation(actor, id); return `Invitation re-sent to ${email}.`; });
}

export async function saveGoalAction(id: string | null, form: FormData) {
  const actor = await requireActor(["admin"]);
  await withFlash("/admin/goals", async () => { await saveGoal(actor, { id: id ?? undefined, text: str(form, "text") }); refresh(); return "Strategic goal saved."; });
}

export async function deleteGoalAction(id: string) {
  const actor = await requireActor(["admin"]);
  await withFlash("/admin/goals", async () => { await deleteGoal(actor, id); refresh(); return "Strategic goal removed."; });
}
