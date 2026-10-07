"use client";

import { useRef, useState } from "react";
import { AttachmentList, type AttachmentChip } from "@/components/attachment-list";
import { ACCEPTED_EXTENSIONS } from "@/lib/extract-types";
import { submitReworkAction, understandReworkAction } from "../../actions";

type Step = "ask" | "describe" | "understand" | "done";
type Context = { summary: string; expected: string; actual: string; impact: string };
const MAX_FILES = 3;

// "Something isn't right": describe (+ optional screenshot) -> AI understood -> confirm,
// refine with AI, or edit -> sent to the team as a rework request.
export function ReworkFlow({ ticketId, looksGood }: { ticketId: string; looksGood: () => Promise<void> }) {
  const [step, setStep] = useState<Step>("ask");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<AttachmentChip[]>([]);
  const [uploading, setUploading] = useState(false);
  const [ctx, setCtx] = useState<Context | null>(null);
  const [correction, setCorrection] = useState("");
  const [refining, setRefining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function upload(list: FileList) {
    setError(null);
    for (const file of Array.from(list)) {
      if (files.length >= MAX_FILES) { setError(`Attach up to ${MAX_FILES} files.`); break; }
      setUploading(true);
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/attachments", { method: "POST", body });
      const json = await res.json();
      setUploading(false);
      if (!res.ok) setError(`${file.name}: ${json.error}`);
      else setFiles((f) => [...f, json]);
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/attachments/${id}`, { method: "DELETE" });
    if (res.ok) setFiles((f) => f.filter((x) => x.id !== id));
  }

  async function understand(withCorrection = "") {
    setBusy(true); setError(null);
    const result = await understandReworkAction({ ticketId, description, attachmentIds: files.map((f) => f.id), correction: withCorrection || undefined });
    setBusy(false);
    if ("error" in result) return setError(result.error);
    setCtx(result.understanding);
    setFiles(result.attachments);
    setRefining(false); setCorrection("");
    setStep("understand");
  }

  async function submit() {
    if (!ctx) return;
    setBusy(true); setError(null);
    const result = await submitReworkAction({ ticketId, description, context: ctx, attachmentIds: files.map((f) => f.id) });
    setBusy(false);
    if ("error" in result) return setError(result.error);
    setStep("done");
  }

  return (
    <div>
      {error && <p className="error" role="alert">{error}</p>}

      {step === "ask" && (
        <div className="btn-row">
          <form action={looksGood}><button className="btn btn-primary" type="submit">Looks good</button></form>
          <button className="btn btn-ghost" type="button" onClick={() => setStep("describe")}>Something isn&apos;t right</button>
        </div>
      )}

      {step === "describe" && (
        <form onSubmit={(e) => { e.preventDefault(); void understand(); }}>
          <label className="field">What isn&apos;t working as you expected?
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000}
              placeholder="e.g. I expected the import to update existing lanes, but it only adds new ones." />
          </label>
          <div className="btn-row" style={{ marginBottom: ".6rem" }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => input.current?.click()} disabled={uploading}>
              {uploading ? "Reading…" : "Attach a screenshot or file"}
            </button>
            <span className="muted">Optional · up to 10 MB</span>
            <input ref={input} type="file" multiple accept={ACCEPTED_EXTENSIONS} className="sr-only" aria-label="Attach files"
              onChange={(e) => { if (e.target.files) void upload(e.target.files); e.target.value = ""; }} />
          </div>
          <AttachmentList items={files} onRemove={remove} />
          <div className="btn-row" style={{ marginTop: "1rem" }}>
            <button className="btn btn-primary" type="submit" disabled={busy || uploading || (!description.trim() && !files.length)}>{busy ? "Reading…" : "Continue"}</button>
            <button className="btn-link" type="button" onClick={() => setStep("ask")}>Cancel</button>
          </div>
        </form>
      )}

      {step === "understand" && ctx && (
        <div>
          <div className="ai-panel" aria-live="polite">
            <span className="ai-tag">AI understood</span>
            <p style={{ marginTop: ".35rem" }}>{ctx.summary}</p>
          </div>
          <AttachmentList items={files} showSummary />
          {refining ? (
            <div style={{ marginTop: "1rem" }}>
              <label className="field">What did we get wrong?
                <textarea value={correction} onChange={(e) => setCorrection(e.target.value)} maxLength={1000}
                  placeholder="e.g. The problem is that existing lanes are duplicated, not skipped." />
              </label>
              <div className="btn-row">
                <button className="btn btn-primary" type="button" onClick={() => understand(correction)} disabled={busy || !correction.trim()}>{busy ? "Reading…" : "Refine with AI"}</button>
                <button className="btn-link" type="button" onClick={() => setRefining(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <p className="muted" style={{ margin: "1rem 0 .5rem" }}>Edit anything that&apos;s not quite right:</p>
              <label className="field">What you expected<textarea value={ctx.expected} onChange={(e) => setCtx({ ...ctx, expected: e.target.value })} /></label>
              <div className="grid g2">
                <label className="field">What happens instead<textarea value={ctx.actual} onChange={(e) => setCtx({ ...ctx, actual: e.target.value })} /></label>
                <label className="field">How it affects your work<textarea value={ctx.impact} onChange={(e) => setCtx({ ...ctx, impact: e.target.value })} /></label>
              </div>
              <div className="btn-row">
                <button className="btn btn-primary" type="button" onClick={submit} disabled={busy}>{busy ? "Sending…" : "Confirm and send to the team"}</button>
                <button className="btn btn-ghost" type="button" onClick={() => setRefining(true)}>Refine with AI</button>
                <button className="btn-link" type="button" onClick={() => setStep("describe")}>Back</button>
              </div>
            </>
          )}
        </div>
      )}

      {step === "done" && (
        <div className="stack" role="status">
          <h3>Thanks, the team has your report</h3>
          <p>The product manager and engineers will review it and decide whether to reopen the work. You&apos;ll see their decision on this page and in My Activity.</p>
        </div>
      )}
    </div>
  );
}
