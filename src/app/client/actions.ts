"use server";

import { revalidatePath } from "next/cache";
import { addSupport, removeSupport } from "@/domain/feedback";
import { getNeed } from "@/domain/needs";
import { requireActor } from "@/domain/session";
import { withFlash } from "@/lib/flash";

export async function toggleSupport(needId: string, support: boolean) {
  const actor = await requireActor(["client"]);
  await withFlash(`/client/needs/${needId}`, async () => {
    if (!(await getNeed(needId))) throw new Error("Customer Need not found");
    if (support) await addSupport(actor.id, needId);
    else await removeSupport(actor.id, needId);
    revalidatePath("/", "layout");
    return support ? "You're supporting this need. We'll email you updates." : "Support removed.";
  });
}
