import type { ReactNode } from "react";
import { signOut } from "@/app/(auth)/login/actions";
import type { SessionActor } from "@/domain/session";
import { ROLE_LABEL } from "@/domain/labels";
import { unreadCount } from "@/domain/notifications";
import { NavLinks, type NavItem } from "./nav-links";

export async function Shell({ actor, items, children, sidebarExtra, overlay }: {
  actor: SessionActor; items: NavItem[]; children: ReactNode; sidebarExtra?: ReactNode; overlay?: ReactNode;
}) {
  // Every role has an inbox at /<role>/notifications.
  const inbox = { href: `/${actor.role}/notifications`, label: "Notifications", icon: "bell", count: await unreadCount(actor.id) };
  const initials = actor.name.split(" ").map((w) => w[0]).join("").slice(0, 2);
  const roleLine = actor.role === "client" && actor.accountName ? `Client · ${actor.accountName}` : ROLE_LABEL[actor.role];
  return (
    <>
      <a className="skip-link" href="#main">Skip to main content</a>
      <aside className="sidebar">
        <a className="brand" href="/"><span className="dot" />Needs Hub</a>
        <NavLinks items={[...items, inbox]} label={ROLE_LABEL[actor.role]} />
        {sidebarExtra}
        <div className="user">
          <span className="avatar" aria-hidden="true">{initials}</span>
          <div className="user-meta">
            <b>{actor.name}</b>
            <span>{roleLine}</span>
            <form action={signOut}><button className="sign-out" type="submit">Sign out</button></form>
          </div>
        </div>
      </aside>
      <main id="main" tabIndex={-1}>
        <div className="page">{children}</div>
      </main>
      {overlay}
    </>
  );
}
