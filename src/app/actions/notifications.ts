"use server";

import { revalidatePath } from "next/cache";
import { markRead, setPreferences } from "@/domain/notifications";
import { requireActor } from "@/domain/session";
import { withFlash } from "@/lib/flash";

// Inbox actions for every role; each acts only on the signed-in user's own notifications.

export async function markAllReadAction() {
  const actor = await requireActor();
  await markRead(actor.id);
  revalidatePath("/", "layout");
}

export async function savePreferencesAction(form: FormData) {
  const actor = await requireActor();
  await withFlash(`/${actor.role}/notifications`, async () => {
    await setPreferences(actor.id, { notifyEmail: form.get("email") === "on", notifyInApp: form.get("inApp") === "on" });
    revalidatePath("/", "layout");
    return "Notification preferences saved.";
  });
}
