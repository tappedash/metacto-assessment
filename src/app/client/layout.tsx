import type { ReactNode } from "react";
import { Shell } from "@/components/shell";
import { requireActor } from "@/domain/session";

export default async function ClientLayout({ children }: { children: ReactNode }) {
  const actor = await requireActor(["client"]);
  return (
    <Shell actor={actor} items={[
      { href: "/client/share", label: "Share Feedback", icon: "message" },
      { href: "/client/discover", label: "Discover", icon: "compass" },
      { href: "/client/activity", label: "My Activity", icon: "clock" },
    ]}>{children}</Shell>
  );
}
