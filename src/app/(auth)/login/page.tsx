import { asc } from "drizzle-orm";
import { getDb } from "@/db/client";
import { accounts, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ROLE_LABEL } from "@/domain/labels";
import { signIn } from "./actions";

export const dynamic = "force-dynamic";

const ORDER = ["client", "engineer", "pm", "admin"] as const;
const DESCRIPTION: Record<string, string> = {
  client: "Share feedback, support needs, follow progress",
  engineer: "Log client feedback, deliver tickets",
  pm: "Triage, decide, approve updates",
  admin: "Clients, staffing, users, goals",
};

// Demo sign-in for local use: pick any seeded user. Real auth is out of MVP scope.
export default async function LoginPage() {
  const rows = await getDb()
    .select({ id: users.id, name: users.name, role: users.role, account: accounts.name })
    .from(users).leftJoin(accounts, eq(accounts.id, users.accountId)).orderBy(asc(users.name));
  return (
    <main id="main" className="page">
      <span className="eyebrow">Demo sign-in</span>
      <h1 className="display" style={{ marginBottom: "1rem" }}>Needs Hub</h1>
      <p className="lede muted" style={{ marginBottom: "1.5rem" }}>Choose a seeded user to see the product from that role. Local demo only.</p>
      {ORDER.map((role) => (
        <section key={role} className="section">
          <div className="section-head"><h2>{ROLE_LABEL[role]}</h2><span className="muted">{DESCRIPTION[role]}</span></div>
          <div className="login-grid">
            {rows.filter((u) => u.role === role).map((u) => (
              <form key={u.id} action={signIn}>
                <input type="hidden" name="userId" value={u.id} />
                <button className="btn btn-ghost" type="submit">{u.name}{u.account ? ` · ${u.account}` : ""}</button>
              </form>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
