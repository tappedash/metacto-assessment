"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { askAssistantAction } from "@/app/actions/assistant";
import { ACCEPTED_EXTENSIONS } from "@/lib/extract-types";

interface Message {
  role: "user" | "assistant";
  text: string;
  links?: { label: string; href: string }[];
  file?: string;
}

export const OPEN_ASSISTANT = "needs-hub:open-assistant";

// Suggested questions depend on where the customer is.
function suggestions(path: string): string[] {
  if (/^\/client\/needs\//.test(path)) return ["What's the latest update?", "Is this feature planned?", "Why was this marked Not Planned?"];
  if (path.startsWith("/client/activity")) return ["What requests have I submitted?", "What happened to my Excel request?", "What needs am I supporting?"];
  if (path.startsWith("/client/share")) return ["Do you already have feedback about CSV export?", "Can you summarize this uploaded document?", "What requests have I submitted?"];
  return ["What happened to my Excel request?", "What's the latest update?", "What needs am I supporting?"];
}

/** Sidebar entry point: opens the drawer from anywhere. */
export function AssistantNavButton() {
  return (
    <button type="button" className="assistant-nav" onClick={() => window.dispatchEvent(new Event(OPEN_ASSISTANT))}>
      <span className="ico i-sparkle" aria-hidden="true" />
      <span className="label">Assistant</span>
    </button>
  );
}

// "Ask Needs Hub": a compact right-side panel, grounded in the customer's own data.
export function AssistantDrawer() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pageNeedId = path.match(/^\/client\/needs\/([0-9a-f-]{36})/)?.[1];

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_ASSISTANT, show);
    return () => window.removeEventListener(OPEN_ASSISTANT, show);
  }, []);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [messages, busy]);

  const ask = useCallback(async (text: string, attachmentId?: string, file?: string) => {
    if (!text.trim() || busy) return;
    const history = messages.map((m) => ({ role: m.role, text: m.text }));
    setMessages((m) => [...m, { role: "user", text, file }]);
    setQuestion("");
    setBusy(true);
    const reply = await askAssistantAction({ question: text, history, pageNeedId, attachmentId });
    setBusy(false);
    setMessages((m) => [...m, { role: "assistant", text: reply.answer, links: reply.links }]);
  }, [busy, messages, pageNeedId]);

  async function attach(list: FileList | null) {
    const file = list?.[0];
    if (!file) return;
    setBusy(true);
    const body = new FormData();
    body.append("file", file);
    const res = await fetch("/api/attachments", { method: "POST", body });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return setMessages((m) => [...m, { role: "assistant", text: json.error ?? "I couldn't read that file." }]);
    await ask("Can you take a look at this file?", json.id, file.name);
  }

  if (!open) {
    return (
      <button type="button" className="assistant-fab" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <span className="ico i-sparkle" aria-hidden="true" /> Ask Needs Hub
      </button>
    );
  }

  return (
    <aside className="assistant" role="dialog" aria-label="Needs Hub Assistant" onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}>
      <header className="assistant-head">
        <span className="ai-tag">Assistant</span>
        <button type="button" className="btn-link" onClick={() => setOpen(false)}>Close</button>
      </header>
      <div className="assistant-body" ref={listRef} aria-live="polite">
        {messages.length === 0 && (
          <div className="stack">
            <p className="muted">Ask about your requests, the needs you support, their status and approved updates. You can also share a file.</p>
            <div className="assistant-suggest">
              {suggestions(path).map((s) => <button key={s} type="button" className="btn btn-ghost btn-sm" onClick={() => ask(s)}>{s}</button>)}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.role === "user" ? "user" : "ai"}`}>
            {m.role === "assistant" && <span className="ai-tag">Needs Hub</span>}
            {m.file && <span className="muted"><span className="ico i-file" aria-hidden="true" /> {m.file}<br /></span>}
            <span style={{ whiteSpace: "pre-line" }}>{m.text}</span>
            {m.links?.length ? (
              <span className="assistant-links">
                {m.links.map((l) => l.href.startsWith("/api/")
                  ? <a key={l.label + l.href} className="btn-link" href={l.href} target="_blank" rel="noreferrer">{l.label}</a>
                  : <Link key={l.label + l.href} className="btn-link" href={l.href}>{l.label}</Link>)}
              </span>
            ) : null}
          </div>
        ))}
        {busy && <div className="bubble ai"><span className="ai-tag">Needs Hub</span><span className="muted">Looking that up…</span></div>}
      </div>
      <form className="assistant-compose" onSubmit={(e) => { e.preventDefault(); void ask(question); }}>
        <label className="sr-only" htmlFor="assistant-q">Ask Needs Hub</label>
        <textarea id="assistant-q" ref={inputRef} rows={2} value={question} onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(question); } }}
          placeholder="Ask about your requests or updates…" />
        <div className="btn-row">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()} disabled={busy}>
            <span className="ico i-file" aria-hidden="true" /> Attach
          </button>
          <input ref={fileRef} type="file" accept={ACCEPTED_EXTENSIONS} className="sr-only" aria-label="Share a file with the assistant"
            onChange={(e) => { void attach(e.target.files); e.target.value = ""; }} />
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !question.trim()}>Ask</button>
        </div>
        <p className="muted" style={{ fontSize: 12 }}>Answers come from your requests and approved updates only. Nothing is submitted without your confirmation.</p>
      </form>
    </aside>
  );
}
