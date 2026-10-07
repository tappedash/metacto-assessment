"use client";

import { useState } from "react";

interface MatchResponse {
  relation: "same" | "related" | "new" | "triage";
  needId: string | null;
  confidence: number;
  reason: string;
  candidates: { needId: string; title: string; similarity: number }[];
}

// Tries the synchronous matching path: POST /api/match.
export function MatchForm() {
  const [title, setTitle] = useState("Export dashboard to Excel");
  const [why, setWhy] = useState("Our finance team reconciles shipping costs every Monday in spreadsheets.");
  const [result, setResult] = useState<MatchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/match", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, why }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      setResult(body);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const best = result?.candidates.find((c) => c.needId === result.needId);
  return (
    <form onSubmit={submit} className="card">
      <label htmlFor="title">What do you need?</label>
      <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required />
      <label htmlFor="why">Why</label>
      <textarea id="why" value={why} onChange={(e) => setWhy(e.target.value)} rows={3} />
      <button type="submit" disabled={busy}>{busy ? "Matching…" : "Find similar needs"}</button>
      {error && <p role="alert">{error}</p>}
      {result && (
        <div className="card result" aria-live="polite">
          <strong>{result.relation.toUpperCase()}</strong>
          {best && <> · {best.title}</>} · confidence {result.confidence}
          <p className="muted">{result.reason}</p>
        </div>
      )}
    </form>
  );
}
