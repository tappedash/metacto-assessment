"use client";

export interface AttachmentChip {
  id: string;
  filename: string;
  type: string;
  sizeBytes: number;
  summary: string | null;
  terms: string[];
  href: string;
}

export const formatSize = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Attachment cards: filename, type, size, what AI understood, open and remove actions. */
export function AttachmentList({ items, onRemove, showSummary = true }: { items: AttachmentChip[]; onRemove?: (id: string) => void; showSummary?: boolean }) {
  if (!items.length) return null;
  return (
    <ul className="attach-list" aria-label="Attachments">
      {items.map((a) => (
        <li key={a.id} className="attach">
          <div className="attach-head">
            <span className="ico i-file" aria-hidden="true" />
            <a className="attach-name" href={a.href} target="_blank" rel="noreferrer">{a.filename}</a>
            <span className="muted">{a.type} · {formatSize(a.sizeBytes)}</span>
            {onRemove && <button type="button" className="btn-link" onClick={() => onRemove(a.id)} aria-label={`Remove ${a.filename}`}>Remove</button>}
          </div>
          {showSummary && a.summary && (
            <div className="attach-ai">
              <span className="ai-tag">AI reviewed your attachment</span>
              <p>{a.summary}</p>
              {a.terms.length > 0 && <p className="muted">Terms: {a.terms.join(", ")}</p>}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
