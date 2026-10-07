import type { ReactNode } from "react";
import { signOut } from "@/app/(auth)/login/actions";
import type { SessionActor } from "@/domain/session";
import { ROLE_LABEL } from "@/domain/labels";
import { NavLinks, type NavItem } from "./nav-links";

export function Shell({ actor, items, children, sidebarExtra, overlay }: {
  actor: SessionActor; items: NavItem[]; children: ReactNode; sidebarExtra?: ReactNode; overlay?: ReactNode;
}) {
  const initials = actor.name.split(" ").map((w) => w[0]).join("").slice(0, 2);
  const roleLine = actor.role === "client" && actor.accountName ? `Client · ${actor.accountName}` : ROLE_LABEL[actor.role];
  return (
    <>
      <a className="skip-link" href="#main">Skip to main content</a>
      <aside className="sidebar">
        <a className="brand" href="/"><span className="dot" />Needs Hub</a>
        <NavLinks items={items} label={ROLE_LABEL[actor.role]} />
        {sidebarExtra}
        <div className="user">
          <span className="avatar" aria-hidden="true">{initials}</span>
          <div className="user-meta">
            <b>{actor.name}</b>
            <span>{roleLine}</span>
            <form action={signOut}><button className="sign-out" type="submit">Switch user</button></form>
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
