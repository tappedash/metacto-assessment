import type { AttachmentView } from "@/domain/attachments";

const size = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Files attached to a Feature Request, shown with the original evidence. */
export function EvidenceFiles({ files }: { files?: AttachmentView[] }) {
  if (!files?.length) return null;
  return (
    <ul className="attach-list" aria-label="Attached files">
      {files.map((f) => (
        <li className="attach" key={f.id}>
          <div className="attach-head">
            <span className="ico i-file" aria-hidden="true" />
            <a className="attach-name" href={f.href} target="_blank" rel="noreferrer">{f.filename}</a>
            <span className="muted">{f.type} · {size(f.sizeBytes)}</span>
          </div>
          {f.summary && <div className="attach-ai"><span className="ai-tag">AI reviewed</span> {f.summary}</div>}
        </li>
      ))}
    </ul>
  );
}
