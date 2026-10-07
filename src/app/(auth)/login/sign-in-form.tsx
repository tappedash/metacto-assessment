"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";

// Continue with Google, or get a one-time sign-in link by email.
export function SignInForm({ googleEnabled, initialEmail }: { googleEnabled: boolean; initialEmail: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function sendLink(event: React.FormEvent) {
    event.preventDefault();
    setState("sending"); setError(null);
    const { error } = await authClient.signIn.magicLink({ email, callbackURL: "/", errorCallbackURL: "/login" });
    if (error) { setState("idle"); return setError(error.message ?? "Couldn't send the link. Try again."); }
    setState("sent");
  }

  async function google() {
    setError(null);
    const { error } = await authClient.signIn.social({ provider: "google", callbackURL: "/", errorCallbackURL: "/login" });
    if (error) setError(error.message ?? "Google sign-in failed.");
  }

  return (
    <div className="card stack" style={{ maxWidth: 420 }}>
      {error && <p className="error" role="alert">{error}</p>}
      {googleEnabled ? (
        <button type="button" className="btn btn-ghost" onClick={google} style={{ width: "100%" }}>Continue with Google</button>
      ) : (
        <p className="muted">Google sign-in isn&apos;t configured on this environment (see README → Google OAuth).</p>
      )}
      <p className="muted" style={{ textAlign: "center" }}>or</p>
      {state === "sent" ? (
        <div role="status" className="stack">
          <h2 style={{ fontSize: "1.1rem" }}>Check your email</h2>
          <p className="muted">If {email} has access to Needs Hub, a sign-in link is on its way. It expires in 10 minutes. Locally, emails arrive in <a href="http://localhost:8025" target="_blank" rel="noreferrer">Mailpit</a>.</p>
          <button type="button" className="btn-link" onClick={() => setState("idle")}>Use a different email</button>
        </div>
      ) : (
        <form onSubmit={sendLink}>
          <label className="field">Work email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" inputMode="email" placeholder="you@company.com" />
          </label>
          <button className="btn btn-primary" type="submit" disabled={state === "sending"} style={{ width: "100%" }}>
            {state === "sending" ? "Sending…" : "Send magic link"}
          </button>
        </form>
      )}
    </div>
  );
}
