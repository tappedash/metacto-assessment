import ExcelJS from "exceljs";
import mammoth from "mammoth";
import { extractText } from "unpdf";
import { MAX_UPLOAD_BYTES } from "./extract-types";

// Text extraction for customer attachments. Images are kept for providers that can look
// at them; the mock provider only sees their filename.

export type AttachmentKind = "pdf" | "document" | "spreadsheet" | "image" | "text";

const TYPES: Record<string, { kind: AttachmentKind; label: string }> = {
  "application/pdf": { kind: "pdf", label: "PDF" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { kind: "document", label: "Word" },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { kind: "spreadsheet", label: "Excel" },
  "text/csv": { kind: "spreadsheet", label: "CSV" },
  "text/plain": { kind: "text", label: "Text" },
  "image/png": { kind: "image", label: "PNG" },
  "image/jpeg": { kind: "image", label: "JPEG" },
  "image/gif": { kind: "image", label: "GIF" },
  "image/webp": { kind: "image", label: "WebP" },
};

const BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

export { MAX_UPLOAD_BYTES } from "./extract-types";
const MAX_TEXT = 20_000;

/** Browsers report MIME types inconsistently; the extension decides when they disagree. */
export function detectType(filename: string, reported: string): { mimeType: string; kind: AttachmentKind; label: string } | null {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const mimeType = BY_EXTENSION[ext] ?? (TYPES[reported] ? reported : "");
  return mimeType ? { mimeType, ...TYPES[mimeType] } : null;
}

export function typeLabel(mimeType: string): string {
  return TYPES[mimeType]?.label ?? "File";
}

export async function extractTextFrom(buffer: Buffer, kind: AttachmentKind, mimeType: string): Promise<string | null> {
  let text: string | null = null;
  if (kind === "pdf") {
    text = (await extractText(new Uint8Array(buffer), { mergePages: true })).text;
  } else if (kind === "document") {
    text = (await mammoth.extractRawText({ buffer })).value;
  } else if (mimeType === "text/csv" || kind === "text") {
    text = buffer.toString("utf8");
  } else if (kind === "spreadsheet") {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const lines: string[] = [];
    workbook.eachSheet((sheet) => {
      lines.push(`# ${sheet.name}`);
      sheet.eachRow((row) => {
        const values = (row.values as unknown[]).slice(1).map((v) => (v && typeof v === "object" && "result" in v ? String((v as { result: unknown }).result) : String(v ?? "")));
        lines.push(values.join(", "));
      });
    });
    text = lines.join("\n");
  }
  return text ? text.replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").trim().slice(0, MAX_TEXT) : null;
}
