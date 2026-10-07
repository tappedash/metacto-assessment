"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { matchConfirmedAction, submitFeedbackAction, understandFeedbackAction } from "@/app/actions/feedback";
import type { Understanding } from "@/domain/ai-tasks";
import type { MatchView, SubmitOutcome } from "@/domain/feedback";
import { NEED_STATUS } from "@/domain/labels";
import { ACCEPTED_EXTENSIONS } from "@/lib/extract-types";
import { AttachmentList, type AttachmentChip } from "./attachment-list";

type Step = "describe" | "understand" | "match" | "done";
const MAX_FILES = 5;

// Client Share Feedback: describe and/or attach -> AI understands -> customer confirms or
// corrects -> AI finds the matching Customer Need -> support it or submit as different.
export function ClientShareFlow({ initialAttachments = [] }: { initialAttachments?: AttachmentChip[] }) {
  const [step, setStep] = useState<Step>("describe");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [files, setFiles] = useState<AttachmentChip[]>(initialAttachments);
  const [uploading, setUploading] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [understanding, setUnderstanding] = useState<Understanding | null>(null);
  const [ctx, setCtx] = useState({ goal: "", workaround: "", impact: "" });
  const [match, setMatch] = useState<MatchView | null>(null);
  const [outcome, setOutcome] = useState<SubmitOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState("");
  const input = useRef<HTMLInputElement>(null);

  async function upload(list: FileList | File[]) {
    setError(null);
    for (const file of Array.from(list)) {
      if (files.length + uploading.length >= MAX_FILES) { setError(`Attach up to ${MAX_FILES} files.`); break; }
      setUploading((u) => [...u, file.name]);
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/attachments", { method: "POST", body });
      const json = await res.json();
      setUploading((u) => u.filter((n) => n !== file.name));
      if (!res.ok) setError(`${file.name}: ${json.error}`);
      else setFiles((f) => [...f, json]);
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/attachments/${id}`, { method: "DELETE" });
    if (res.ok) setFiles((f) => f.filter((x) => x.id !== id));
    else setError((await res.json()).error);
  }

  async function understand(event: React.FormEvent | null, withReply = "") {
    event?.preventDefault();
    setBusy(true); setError(null);
    // A reply to AI (answer or correction) becomes part of the customer's own description.
    const text = withReply.trim() ? `${details.trim()}\n${withReply.trim()}`.trim() : details;
    const result = await understandFeedbackAction({ title, details: text, attachmentIds: files.map((f) => f.id) });
    setBusy(false);
    if ("error" in result) return setError(result.error);
    setUnderstanding(result.understanding);
    setTitle(title.trim() || result.understanding.title);
    setCtx({ goal: result.understanding.goal, workaround: result.understanding.workaround, impact: result.understanding.impact });
    setFiles(result.attachments.map((a) => ({ ...a })));
    setDetails(text);
    setReply("");
    setStep("understand");
  }

  async function findMatch() {
    if (!understanding) return;
    setBusy(true); setError(null);
    const result = await matchConfirmedAction({ title, context: { summary: understanding.summary, terms: understanding.terms, ...ctx } });
    setBusy(false);
    if ("error" in result) return setError(result.error);
    setMatch(result.match);
    setStep("match");
  }

  async function submit(choice: "support" | "different") {
    if (!match || !understanding) return;
    setBusy(true); setError(null);
    // The server builds the evidence text from the confirmed context.
    const result = await submitFeedbackAction({
      title, why: details, choice, needId: match.needId, relation: match.relation, confidence: match.confidence, reason: match.reason,
      context: { summary: understanding.summary, terms: understanding.terms, ...ctx }, attachmentIds: files.map((f) => f.id),
    });
    setBusy(false);
    if ("error" in result) return setError(result.error);
    setOutcome(result);
    setStep("done");
  }

  function reset() {
    setStep("describe"); setTitle(""); setDetails(""); setFiles([]); setUnderstanding(null);
    setCtx({ goal: "", workaround: "", impact: "" }); setMatch(null); setOutcome(null); setError(null);
  }

  const steps = ["Describe", "Understand", "Match", "Done"];
  const current = { describe: 1, understand: 2, match: 3, done: 4 }[step];

  return (
    <div className="card">
      <ol className="steps" aria-label="Progress">
        {steps.map((s, i) => <li key={s} className={i + 1 < current ? "done" : undefined} aria-current={i + 1 === current ? "step" : undefined}>{s}</li>)}
      </ol>
      {error && <p className="error" role="alert">{error}</p>}

      {step === "describe" && (
        <form onSubmit={understand}>
          <label className="field">What do you need? <span className="hint">(a short description)</span>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Export dashboard to Excel" maxLength={200} />
          </label>
          <label className="field">Tell us more <span className="hint">(optional: what you're trying to do, what you do today)</span>
            <textarea value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Our finance team reconciles shipping costs every Monday…" />
          </label>
          <div
            className={`dropzone${dragging ? " over" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); void upload(e.dataTransfer.files); }}
          >
            <span className="ico i-file" aria-hidden="true" />
            <span>Drag files here or <button type="button" className="btn-link" onClick={() => input.current?.click()}>browse</button></span>
            <span className="muted">PDF, Word, Excel, CSV or screenshots · up to 10 MB · optional</span>
            <input ref={input} type="file" multiple accept={ACCEPTED_EXTENSIONS} className="sr-only" aria-label="Attach files"
              onChange={(e) => { if (e.target.files) void upload(e.target.files); e.target.value = ""; }} />
          </div>
          {uploading.length > 0 && <p className="muted" role="status" aria-live="polite"><span className="ai-tag">Reading {uploading.join(", ")}…</span></p>}
          <AttachmentList items={files} onRemove={remove} />
          <button className="btn btn-primary" type="submit" disabled={busy || uploading.length > 0 || (!title.trim() && !details.trim() && !files.length)} style={{ marginTop: "1rem" }}>
            {busy ? "Reading…" : "Continue"}
          </button>
        </form>
      )}

      {step === "understand" && understanding && (
        <div>
          <div className="ai-panel" aria-live="polite">
            <span className="ai-tag">AI understood</span>
            <p style={{ marginTop: ".35rem" }}>{understanding.summary}</p>
            {understanding.terms.length > 0 && <p className="muted" style={{ marginTop: ".5rem" }}>Terms: {understanding.terms.join(", ")}</p>}
          </div>
          <form className="stack" style={{ marginTop: ".8rem" }} onSubmit={(e) => { e.preventDefault(); void understand(null, reply); }}>
            <label className="field" style={{ margin: 0 }}>{understanding.question || "Not quite right? Tell AI what it missed"}
              <textarea value={reply} onChange={(e) => setReply(e.target.value)} maxLength={1000} placeholder="e.g. The real problem is that month-end close takes two days." />
            </label>
            <div><button className="btn btn-ghost btn-sm" type="submit" disabled={busy || !reply.trim()}>{busy ? "Reading…" : "Refine with AI"}</button></div>
          </form>
          <AttachmentList items={files} showSummary />
          <p className="muted" style={{ margin: "1rem 0 .5rem" }}>Or edit the details directly:</p>
          <label className="field">Short title<input type="text" value={title} onChange={(e) => setTitle(e.target.value)} required /></label>
          <label className="field">What you&apos;re trying to accomplish<textarea value={ctx.goal} onChange={(e) => setCtx({ ...ctx, goal: e.target.value })} /></label>
          <div className="grid g2">
            <label className="field">How you handle it today<textarea value={ctx.workaround} onChange={(e) => setCtx({ ...ctx, workaround: e.target.value })} /></label>
            <label className="field">Pain / impact<textarea value={ctx.impact} onChange={(e) => setCtx({ ...ctx, impact: e.target.value })} /></label>
          </div>
          <div className="btn-row">
            <button className="btn btn-primary" onClick={findMatch} disabled={busy || title.trim().length < 3}>{busy ? "Looking…" : "Yes, find matching needs"}</button>
            <button className="btn-link" onClick={() => setStep("describe")}>Back</button>
          </div>
        </div>
      )}

      {step === "match" && match && (
        <div>
          {match.need ? (
            <>
              <h2 style={{ marginBottom: "1rem" }}>Is this your need?</h2>
              <div className="ai-panel">
                <div className="item-head" style={{ justifyContent: "space-between" }}>
                  <span className="ai-tag">AI Match</span>
                  <span className={`chip ${NEED_STATUS[match.need.status].chip}`}>{NEED_STATUS[match.need.status].label}</span>
                </div>
                <h3 style={{ fontSize: "1.2rem" }}>{match.need.title}</h3>
                <p style={{ marginTop: ".35rem" }}>{match.need.problemStatement}</p>
                <p className="strong" style={{ marginTop: ".7rem" }}>{match.need.supporters} {match.need.supporters === 1 ? "person has" : "people have"} described a similar problem.</p>
                <div className="based-on"><span><b>Why we think it matches:</b> {match.reason}</span></div>
              </div>
              <div className="btn-row" style={{ marginTop: "1.1rem" }}>
                <button className="btn btn-primary" onClick={() => submit("support")} disabled={busy}>Yes, support this need</button>
                <button className="btn btn-ghost" onClick={() => submit("different")} disabled={busy}>No, mine is different</button>
                <button className="btn-link" onClick={() => setStep("understand")}>Back</button>
              </div>
            </>
          ) : (
            <>
              <h2 style={{ marginBottom: ".6rem" }}>{match.relation === "triage" ? "We couldn't check for similar needs right now" : "This looks like a new need"}</h2>
              <p className="muted" style={{ marginBottom: "1rem" }}>A product manager will review it, with your files attached.</p>
              <div className="btn-row">
                <button className="btn btn-primary" onClick={() => submit("different")} disabled={busy}>Submit as a new request</button>
                <button className="btn-link" onClick={() => setStep("understand")}>Back</button>
              </div>
            </>
          )}
        </div>
      )}

      {step === "done" && outcome && (
        <div className="stack" role="status">
          <h2>{outcome.outcome === "attached" ? "You're now supporting this need" : "Thanks, we've logged your request"}</h2>
          <p>{outcome.outcome === "attached"
            ? `Your request${files.length ? ` and ${files.length} file${files.length === 1 ? "" : "s"}` : ""} were added as evidence for the product team. We'll email you when the status changes.`
            : "A product manager will review it and group it with the right need. You'll be notified when its status changes."}</p>
          <div className="btn-row">
            {outcome.needId ? <Link className="btn btn-dark" href={`/client/needs/${outcome.needId}`}>Follow this need</Link> : <Link className="btn btn-dark" href="/client/activity">View my activity</Link>}
            <button className="btn btn-ghost" onClick={reset}>Share something else</button>
          </div>
        </div>
      )}
    </div>
  );
}
