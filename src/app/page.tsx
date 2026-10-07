import { redirect } from "next/navigation";
import { ROLE_HOME } from "@/domain/labels";
import { getActor } from "@/domain/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const actor = await getActor();
  redirect(actor ? ROLE_HOME[actor.role] : "/login");
}
