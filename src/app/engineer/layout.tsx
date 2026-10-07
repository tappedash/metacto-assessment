import type { ReactNode } from "react";
import { Shell } from "@/components/shell";
import { requireActor } from "@/domain/session";

export default async function EngineerLayout({ children }: { children: ReactNode }) {
  const actor = await requireActor(["engineer"]);
  return (
    <Shell actor={actor} items={[
      { href: "/engineer/work", label: "My Work", icon: "tasks" },
      { href: "/engineer/projects", label: "Projects", icon: "folder" },
      { href: "/engineer/log", label: "Log Client Feedback", icon: "pen" },
      { href: "/engineer/updates", label: "Approved Updates", icon: "send" },
    ]}>{children}</Shell>
  );
}
