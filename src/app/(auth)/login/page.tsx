import { redirect } from "next/navigation";
import { param, type SearchParams } from "@/components/ui";
import { ROLE_HOME } from "@/domain/labels";
import { getActor } from "@/domain/session";
import { getEnv, googleConfigured } from "@/lib/env";
import { SignInForm } from "./sign-in-form";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  NOT_INVITED: "This email hasn't been invited to Needs Hub. Ask your workspace admin for an invitation.",
  EXPIRED_TOKEN: "That sign-in link has expired. Send a new one.",
  INVALID_TOKEN: "That sign-in link isn't valid any more. Send a new one.",
};

const DEMO_USERS = [
  ["Client", "lena@northwind.example"], ["Engineer", "ravi@needs-hub.local"],
  ["Product Manager", "sam@needs-hub.local"], ["Workspace Admin", "alex@needs-hub.local"],
  ["Invited (first sign-in)", "maya@cedar.example"],
];

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await getActor();
  if (actor) redirect(ROLE_HOME[actor.role]);
  const sp = await searchParams;
  const code = param(sp.error).toUpperCase();
  const error = code ? ERRORS[code] ?? "Sign-in didn't work. Try again." : null;
  return (
    <main id="main" className="page">
      <span className="eyebrow">Sign in</span>
      <h1 className="display" style={{ marginBottom: ".75rem" }}>Needs Hub</h1>
      <p className="lede muted" style={{ marginBottom: "1.5rem" }}>Access is by invitation. Sign in with the email your workspace admin invited.</p>
      {error && <p className="notice err" role="alert" style={{ maxWidth: 420 }}>{error}</p>}
      <SignInForm googleEnabled={googleConfigured(getEnv())} initialEmail={param(sp.email)} />
      {process.env.NODE_ENV !== "production" && (
        <details className="card" style={{ maxWidth: 420, marginTop: "1rem" }}>
          <summary className="strong">Local demo accounts</summary>
          <p className="muted" style={{ margin: ".5rem 0" }}>Send a magic link to any of these; open it from <a href="http://localhost:8025" target="_blank" rel="noreferrer">Mailpit</a>.</p>
          <ul className="muted" style={{ margin: 0, paddingLeft: "1.1rem" }}>
            {DEMO_USERS.map(([role, email]) => <li key={email}><b className="strong">{role}:</b> {email}</li>)}
          </ul>
        </details>
      )}
    </main>
  );
}
