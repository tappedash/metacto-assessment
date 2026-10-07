import type { ReactNode } from "react";
import { Shell } from "@/components/shell";
import { draftCount } from "@/domain/decisions";
import { requireActor } from "@/domain/session";
import { triageCount } from "@/domain/triage";

export default async function PmLayout({ children }: { children: ReactNode }) {
  const actor = await requireActor(["pm"]);
  const [triage, drafts] = await Promise.all([triageCount(), draftCount()]);
  return (
    <Shell actor={actor} items={[
      { href: "/pm/triage", label: "Triage", icon: "inbox", count: triage },
      { href: "/pm/needs", label: "Customer Needs", icon: "layers" },
      { href: "/pm/tickets", label: "Tickets", icon: "kanban" },
      { href: "/pm/updates", label: "Updates", icon: "send", count: drafts },
    ]}>{children}</Shell>
  );
}
