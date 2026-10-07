import type { ReactNode } from "react";
import { Shell } from "@/components/shell";
import { requireActor } from "@/domain/session";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const actor = await requireActor(["admin"]);
  return (
    <Shell actor={actor} items={[
      { href: "/admin/clients", label: "Clients", icon: "building" },
      { href: "/admin/projects", label: "Projects", icon: "folder" },
      { href: "/admin/staffing", label: "Staffing", icon: "users" },
      { href: "/admin/users", label: "Users", icon: "user" },
      { href: "/admin/goals", label: "Strategic Goals", icon: "target" },
      { href: "/admin/needs", label: "Customer Needs", icon: "eye" },
      { href: "/admin/settings", label: "Settings", icon: "settings" },
    ]}>{children}</Shell>
  );
}
