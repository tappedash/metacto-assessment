"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ROLE_HOME } from "@/domain/labels";
import { loadActor, SESSION_COOKIE } from "@/domain/session";

export async function signIn(formData: FormData) {
  const actor = await loadActor(String(formData.get("userId") ?? ""));
  if (!actor) redirect("/login");
  (await cookies()).set(SESSION_COOKIE, actor.id, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect(ROLE_HOME[actor.role]);
}

export async function signOut() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
