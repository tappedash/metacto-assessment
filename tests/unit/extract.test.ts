import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MockLanguageModel } from "@/ai/mock";
import { AttachmentSummary, SUMMARIZE_ATTACHMENT, UNDERSTAND_FEEDBACK, Understanding, keyTerms } from "@/domain/ai-tasks";
import { detectType, extractTextFrom } from "@/lib/extract";

const llm = new MockLanguageModel();

describe("attachment types", () => {
  it("trusts the extension when browsers report odd MIME types", () => {
    expect(detectType("report.csv", "application/vnd.ms-excel")?.kind).toBe("spreadsheet");
    expect(detectType("notes.docx", "application/octet-stream")?.kind).toBe("document");
    expect(detectType("shot.PNG", "")?.kind).toBe("image");
    expect(detectType("script.exe", "application/octet-stream")).toBeNull();
    expect(detectType("vector.svg", "image/svg+xml")).toBeNull(); // never served as a page
  });
});

describe("text extraction", () => {
  it("reads PDFs and CSVs", async () => {
    const pdf = await extractTextFrom(readFileSync("docs/demo/weekly-report-process.pdf"), "pdf", "application/pdf");
    expect(pdf).toMatch(/reconcile carrier invoices/);
    const csv = await extractTextFrom(readFileSync("docs/demo/weekly-shipment-report.csv"), "spreadsheet", "text/csv");
    expect(csv).toMatch(/^Week,Carrier,Shipments/);
  });
});

describe("AI understanding (mock)", () => {
  it("summarises an attachment in plain language", async () => {
    const out = await llm.generateStructured({ name: SUMMARIZE_ATTACHMENT, instructions: "", schema: AttachmentSummary,
      input: { filename: "weekly-shipment-report.csv", kind: "spreadsheet", text: readFileSync("docs/demo/weekly-shipment-report.csv", "utf8") } });
    expect(out.summary).toMatch(/^This spreadsheet appears to show 4 rows tracking Week, Carrier/);
  });

  it("combines description and files into goal, workaround and impact", async () => {
    const text = (await extractTextFrom(readFileSync("docs/demo/weekly-report-process.pdf"), "pdf", "application/pdf"))!;
    const out = await llm.generateStructured({ name: UNDERSTAND_FEEDBACK, instructions: "", schema: Understanding,
      input: { title: "", details: "", attachments: [{ filename: "weekly-report-process.pdf", kind: "pdf", summary: "", excerpt: text }] } });
    expect(out.summary).toMatch(/^From your document, it looks like/);
    expect(out.summary).toMatch(/Is that the main problem\?$/);
    expect(out.goal).toMatch(/reconcile|export/i);
    expect(out.workaround).toMatch(/by hand|copy|export/i);
    expect(out.impact).toMatch(/3 hours/);
    expect(out.title).toBe("weekly report process");
  });

  it("finds key terms", () => {
    expect(keyTerms("Every Monday Finance exports to Excel. Excel CSV and Finance again.")).toEqual(expect.arrayContaining(["Excel", "Finance", "CSV"]));
  });
});
