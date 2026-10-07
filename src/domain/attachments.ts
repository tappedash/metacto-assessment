import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getAi } from "@/ai";
import { getDb } from "@/db/client";
import { attachments, requests } from "@/db/schema";
import { detectType, extractTextFrom, MAX_UPLOAD_BYTES, typeLabel } from "@/lib/extract";
import { AttachmentSummary, SUMMARIZE_ATTACHMENT, SUMMARIZE_ATTACHMENT_INSTRUCTIONS } from "./ai-tasks";
import { canViewAccountEvidence, type Actor } from "./permissions";

// Customer attachments: local disk storage for the MVP, text extracted for AI, and a
// visible "AI reviewed your attachment" summary. Owners, the PM and engineers staffed on
// the request's account may open them.

const STORAGE_DIR = join(process.cwd(), "storage", "uploads");
const AI_TEXT_LIMIT = 6_000;

export interface AttachmentView {
  id: string;
  filename: string;
  type: string;
  kind: string;
  sizeBytes: number;
  summary: string | null;
  terms: string[];
  href: string;
}

type Row = typeof attachments.$inferSelect;

export function toView(row: Row): AttachmentView {
  const ai = row.aiSummary as AttachmentSummary | null;
  return {
    id: row.id, filename: row.filename, type: typeLabel(row.mimeType), kind: row.kind, sizeBytes: row.sizeBytes,
    summary: ai?.summary ?? null, terms: ai?.terms ?? [], href: `/api/attachments/${row.id}`,
  };
}

export async function saveUpload(actor: Actor, file: { name: string; type: string; size: number; bytes: Buffer }): Promise<AttachmentView> {
  if (actor.role !== "client" && actor.role !== "engineer") throw new Error("This role can't upload attachments");
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("Files can be up to 10 MB.");
  const detected = detectType(file.name, file.type);
  if (!detected) throw new Error("Upload a PDF, Word (DOCX), Excel (XLSX), CSV, text file or image.");

  const id = randomUUID();
  await mkdir(STORAGE_DIR, { recursive: true });
  const storagePath = join(STORAGE_DIR, id);
  await writeFile(storagePath, file.bytes);

  let text: string | null = null;
  try {
    text = await extractTextFrom(file.bytes, detected.kind, detected.mimeType);
  } catch {
    text = null; // unreadable file: still attached, AI just sees the filename
  }
  let summary: AttachmentSummary | null = null;
  try {
    summary = await getAi().llm.generateStructured({
      name: SUMMARIZE_ATTACHMENT, instructions: SUMMARIZE_ATTACHMENT_INSTRUCTIONS, schema: AttachmentSummary,
      input: { filename: file.name, kind: detected.kind, text: text?.slice(0, AI_TEXT_LIMIT) ?? null },
      images: detected.kind === "image" ? [{ mimeType: detected.mimeType, dataBase64: file.bytes.toString("base64") }] : undefined,
    });
  } catch {
    summary = null;
  }
  const [row] = await getDb().insert(attachments).values({
    id, ownerId: actor.id, filename: file.name.slice(0, 200), mimeType: detected.mimeType, kind: detected.kind,
    sizeBytes: file.size, storagePath, extractedText: text, aiSummary: summary,
  }).returning();
  return toView(row);
}

export async function ownedAttachments(actor: Actor, ids: string[], opts: { unlinkedOnly?: boolean } = {}) {
  if (!ids.length) return [];
  const conditions = [eq(attachments.ownerId, actor.id), inArray(attachments.id, ids)];
  if (opts.unlinkedOnly) conditions.push(isNull(attachments.requestId));
  return getDb().select().from(attachments).where(and(...conditions));
}

export async function myAttachments(actor: Actor, limit = 10) {
  const rows = await getDb().select().from(attachments).where(eq(attachments.ownerId, actor.id)).orderBy(attachments.createdAt);
  return rows.slice(-limit);
}

/** Link uploaded files to the Feature Request they were submitted with. */
export async function linkAttachments(actor: Actor, ids: string[], requestId: string) {
  if (!ids.length) return;
  await getDb().update(attachments).set({ requestId })
    .where(and(eq(attachments.ownerId, actor.id), inArray(attachments.id, ids), isNull(attachments.requestId)));
}

export async function removeAttachment(actor: Actor, id: string) {
  const [row] = await getDb().select().from(attachments).where(and(eq(attachments.id, id), eq(attachments.ownerId, actor.id)));
  if (!row) throw new Error("Attachment not found");
  if (row.requestId) throw new Error("This file is already part of a submitted request");
  await getDb().delete(attachments).where(eq(attachments.id, id));
  await rm(row.storagePath, { force: true });
}

/** Owner always; PM always; engineers only for requests from accounts they are staffed on. */
export async function readAttachment(actor: Actor, id: string) {
  const [row] = await getDb().select().from(attachments).where(eq(attachments.id, id));
  if (!row) return null;
  let allowed = row.ownerId === actor.id || actor.role === "pm";
  if (!allowed && actor.role === "engineer" && row.requestId) {
    const [req] = await getDb().select({ accountId: requests.accountId }).from(requests).where(eq(requests.id, row.requestId));
    allowed = Boolean(req && canViewAccountEvidence(actor, req.accountId));
  }
  if (!allowed) return null;
  return { row, bytes: await readFile(row.storagePath) };
}

export async function attachmentsForRequests(requestIds: string[]) {
  if (!requestIds.length) return new Map<string, AttachmentView[]>();
  const rows = await getDb().select().from(attachments).where(inArray(attachments.requestId, requestIds));
  const map = new Map<string, AttachmentView[]>();
  for (const r of rows) map.set(r.requestId!, [...(map.get(r.requestId!) ?? []), toView(r)]);
  return map;
}
