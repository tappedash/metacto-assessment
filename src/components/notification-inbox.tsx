import Link from "next/link";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { markAllReadAction, savePreferencesAction } from "@/app/actions/notifications";
import { inbox } from "@/domain/notifications";
import type { SessionActor } from "@/domain/session";
import { Notice, PageHead, param, type SearchParams } from "./ui";

const when = (d: Date) => d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** The signed-in user's notifications plus their two preferences. Shared by every role. */
export async function NotificationInbox({ actor, searchParams }: { actor: SessionActor; searchParams: SearchParams }) {
  const sp = await searchParams;
  const [items, [prefs]] = await Promise.all([
    inbox(actor.id),
    getDb().select({ notifyEmail: users.notifyEmail, notifyInApp: users.notifyInApp }).from(users).where(eq(users.id, actor.id)),
  ]);
  const unread = items.filter((n) => !n.readAt).length;
  return (
    <>
      <PageHead eyebrow="Notifications" title="What changed for you" lede="Things that involve you: assignments, status changes, updates and customer feedback." />
      <Notice notice={param(sp.notice)} error={param(sp.error)} />
      <div className="grid split">
        <div className="card">
          <div className="item-head" style={{ justifyContent: "space-between", marginBottom: ".6rem" }}>
            <h2 style={{ fontSize: "1.05rem" }}>{unread ? `${unread} unread` : "All caught up"}</h2>
            {unread > 0 && <form action={markAllReadAction}><button className="btn btn-ghost btn-sm" type="submit">Mark all read</button></form>}
          </div>
          {items.length ? (
            <ul className="stack" aria-label="Notifications">
              {items.map((n) => (
                <li key={n.id} className={n.readAt ? "muted" : undefined}>
                  <Link className="btn-link strong" href={n.href}>{n.title}</Link>{!n.readAt && <span className="chip st-planned" style={{ marginLeft: ".4rem", fontSize: 11 }}>New</span>}
                  <br /><span className="when">{when(n.createdAt)}</span>
                  <p style={{ whiteSpace: "pre-line", marginTop: ".2rem" }}>{n.body}</p>
                </li>
              ))}
            </ul>
          ) : <p className="muted">Nothing yet.</p>}
        </div>
        <form className="card" action={savePreferencesAction}>
          <h2 style={{ fontSize: "1.05rem", marginBottom: ".8rem" }}>How you hear about it</h2>
          <label className="check"><input type="checkbox" name="inApp" defaultChecked={prefs.notifyInApp} /> In Needs Hub</label>
          <label className="check"><input type="checkbox" name="email" defaultChecked={prefs.notifyEmail} /> By email</label>
          <p className="muted" style={{ margin: ".6rem 0 1rem" }}>Assignments and rework requests always appear here, so nothing that needs you is missed.</p>
          <button className="btn btn-primary btn-sm" type="submit">Save preferences</button>
        </form>
      </div>
    </>
  );
}
