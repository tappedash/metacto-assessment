"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { checkFeedbackAction, submitFeedbackAction } from "@/app/actions/feedback";
import type { MatchView, SubmitOutcome } from "@/domain/feedback";
import { NEED_STATUS } from "@/domain/labels";

interface Target { id: string; name: string; projects: { id: string; name: string }[] }

type Step = "describe" | "match" | "done";

// Client "Share Feedback" and engineer "Log Client Feedback":
// describe (+ one AI follow-up if needed) -> AI match -> confirm -> attached or PM triage.
export function ShareFlow({ mode, targets = [] }: { mode: "client" | "engineer"; targets?: Target[] }) {
  const engineer = mode === "engineer";
  const [step, setStep] = useState<Step>("describe");
  const [title, setTitle] = useState("");
  const [why, setWhy] = useState("");
  const [question, setQuestion] = useState<string | null>(null);
  const [accountId, setAccountId] = useState(targets[0]?.id ?? "");
  const [projectId, setProjectId] = useState(targets[0]?.projects[0]?.id ?? "");
  const [match, setMatch] = useState<MatchView | null>(null);
  const [outcome, setOutcome] = useState<SubmitOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const projects = useMemo(() => targets.find((t) => t.id === accountId)?.projects ?? [], [targets, accountId]);

  async function find(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await checkFeedbackAction({ title, why, skipFollowUp: question !== null });
    setBusy(false);
    if (result.kind === "error") return setError(result.error);
    if (result.kind === "follow_up") return setQuestion(result.question);
    setMatch(result.match);
    setStep("match");
  }

  async function submit(choice: "support" | "different") {
    if (!match) return;
    setBusy(true);
    setError(null);
    const result = await submitFeedbackAction({
      title, why, choice, needId: match.needId, relation: match.relation, confidence: match.confidence, reason: match.reason,
      ...(engineer ? { accountId, projectId: projectId || undefined } : {}),
    });
    setBusy(false);
    if ("error" in result) return setError(result.error);
    setOutcome(result);
    setStep("done");
  }

  function reset() {
    setStep("describe"); setTitle(""); setWhy(""); setQuestion(null); setMatch(null); setOutcome(null); setError(null);
  }

  const steps = ["Describe", "Match", "Done"];
  const current = { describe: 1, match: 2, done: 3 }[step];
  const needHref = (id: string) => (engineer ? `/engineer/needs/${id}` : `/client/needs/${id}`);

  return (
    <div className="card">
      <ol className="steps" aria-label="Progress">
        {steps.map((s, i) => (
          <li key={s} className={i + 1 < current ? "done" : undefined} aria-current={i + 1 === current ? "step" : undefined}>{s}</li>
        ))}
      </ol>
      {error && <p className="error" role="alert">{error}</p>}

      {step === "describe" && (
        <form onSubmit={find}>
          {engineer && (
            <div className="grid g2">
              <label className="field">Client <span className="req" aria-hidden="true">*</span>
                <select value={accountId} onChange={(e) => { setAccountId(e.target.value); setProjectId(targets.find((t) => t.id === e.target.value)?.projects[0]?.id ?? ""); }} required>
                  {targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
              <label className="field">Project / engagement
                <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                  <option value="">No specific project</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            </div>
          )}
          <label className="field">{engineer ? "What the client asked for" : "What do you need?"} <span className="req" aria-hidden="true">*</span>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} placeholder={engineer ? "e.g. Download the monthly shipment report as CSV" : "e.g. Export dashboard to Excel"} />
          </label>
          {question && (
            <div className="chat" aria-live="polite" style={{ marginBottom: ".75rem" }}>
              <div className="bubble ai"><span className="ai-tag">Quick question</span>{question}</div>
            </div>
          )}
          <label className="field">{question ? "Your answer" : engineer ? "Why (the client's goal)" : "Why does it matter?"} <span className="hint">{question ? "" : "(optional, helps us find the right need)"}</span>
            <textarea value={why} onChange={(e) => setWhy(e.target.value)} placeholder="What are you trying to get done, and what do you do today?" />
          </label>
          <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Looking…" : engineer ? "Find matching Customer Need" : "Find similar needs"}</button>
        </form>
      )}

      {step === "match" && match && (
        <div>
          {match.need ? (
            <>
              <h2 style={{ marginBottom: "1rem" }}>{engineer ? "Does this represent the client's problem?" : "Is this your need?"}</h2>
              <div className="ai-panel">
                <div className="item-head" style={{ justifyContent: "space-between" }}>
                  <span className="ai-tag">AI Match{engineer ? ` · ${Math.round(match.confidence * 100)}% confidence` : ""}</span>
                  <span className={`chip ${NEED_STATUS[match.need.status].chip}`}>{NEED_STATUS[match.need.status].label}</span>
                </div>
                <h3 style={{ fontSize: "1.2rem" }}>{match.need.title}</h3>
                <p style={{ marginTop: ".35rem" }}>{match.need.problemStatement}</p>
                <p className="strong" style={{ marginTop: ".7rem" }}>
                  {match.need.supporters} {match.need.supporters === 1 ? "person has" : "people have"} described a similar problem.
                </p>
                <div className="based-on"><span><b>Why we think it matches:</b> {match.reason}</span></div>
              </div>
              <div className="btn-row" style={{ marginTop: "1.1rem" }}>
                <button className="btn btn-primary" onClick={() => submit("support")} disabled={busy}>{engineer ? "Yes, attach this feedback" : "Yes, support this need"}</button>
                <button className="btn btn-ghost" onClick={() => submit("different")} disabled={busy}>{engineer ? "No, this is different" : "No, mine is different"}</button>
                <button className="btn-link" onClick={() => setStep("describe")}>Edit request</button>
              </div>
            </>
          ) : (
            <>
              <h2 style={{ marginBottom: ".6rem" }}>{match.relation === "triage" ? "We couldn't check for similar needs right now" : "This looks like a new need"}</h2>
              <p className="muted" style={{ marginBottom: "1rem" }}>{match.relation === "triage" ? "Your request will still be saved and a product manager will review it." : "No existing need describes this problem yet. A product manager will review it."}</p>
              <div className="btn-row">
                <button className="btn btn-primary" onClick={() => submit("different")} disabled={busy}>Submit as a new request</button>
                <button className="btn-link" onClick={() => setStep("describe")}>Edit request</button>
              </div>
            </>
          )}
        </div>
      )}

      {step === "done" && outcome && (
        <div className="stack" role="status">
          {outcome.outcome === "attached" ? (
            <>
              <h2>{engineer ? "Attached as evidence" : "You're now supporting this need"}</h2>
              <p>{engineer ? "Added to the Customer Need. No PM triage needed because you confirmed the match. No delivery ticket was created." : "Your request and your reason were added as evidence for the product team. We'll email you when the status changes."}</p>
            </>
          ) : (
            <>
              <h2>{engineer ? "Sent to PM Triage" : "Thanks, we've logged your request"}</h2>
              <p>{engineer ? "The PM will decide whether it's a new Customer Need or belongs to an existing one." : "A product manager will review it and group it with the right need. You'll be notified when its status changes."}</p>
            </>
          )}
          <div className="btn-row">
            {outcome.needId && <Link className="btn btn-dark" href={needHref(outcome.needId)}>{engineer ? "Open Customer Need" : "Follow this need"}</Link>}
            {!engineer && !outcome.needId && <Link className="btn btn-dark" href="/client/activity">View my activity</Link>}
            <button className="btn btn-ghost" onClick={reset}>{engineer ? "Log more feedback" : "Share something else"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
