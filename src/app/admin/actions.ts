"use server";

import { revalidatePath } from "next/cache";
import { createAccount, deleteGoal, saveGoal, setStaffing, setUserRole } from "@/domain/admin";
import { inviteUser, revokeInvitation } from "@/domain/invitations";
import type { Role } from "@/domain/permissions";
import { requireActor } from "@/domain/session";
import { str, withFlash } from "@/lib/flash";

const refresh = () => revalidatePath("/", "layout");

export async function createAccountAction(form: FormData) {
  const actor = await requireActor(["admin"]);
  await withFlash("/admin/clients", async () => {
    const value = Number(str(form, "contractValue").replace(/[^0-9]/g, ""));
    await createAccount(actor, {
      name: str(form, "name"), type: str(form, "type") === "prospect" ? "prospect" : "client",
      tier: str(form, "tier"), segment: str(form, "segment"), contractValue: value > 0 ? value : null,
    });
    refresh();
    return `${str(form, "name")} onboarded.`;
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
  await withFlash("/admin/users", async () => { await setUserRole(actor, userId, str(form, "role") as Role); refresh(); return "Role updated."; });
}

export async function saveGoalAction(id: string | null, form: FormData) {
  const actor = await requireActor(["admin"]);
  await withFlash("/admin/goals", async () => { await saveGoal(actor, { id: id ?? undefined, text: str(form, "text") }); refresh(); return "Strategic goal saved."; });
}

export async function deleteGoalAction(id: string) {
  const actor = await requireActor(["admin"]);
  await withFlash("/admin/goals", async () => { await deleteGoal(actor, id); refresh(); return "Strategic goal removed."; });
}
