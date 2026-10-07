import { describe, expect, it } from "vitest";
import { mockEmbed, tokenize } from "@/ai/mock";
import { EMBEDDING_DIMENSIONS } from "@/db/schema";

const cosine = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + v * b[i], 0);

describe("mock embeddings", () => {
  it("are deterministic, unit-length and match the pgvector column size", () => {
    const a = mockEmbed("Export dashboard to Excel");
    expect(a).toEqual(mockEmbed("Export dashboard to Excel"));
    expect(a).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(Math.hypot(...a)).toBeCloseTo(1, 6);
  });

  it("place different wordings of the same problem closer than unrelated problems", () => {
    const exportNeed = mockEmbed("Use product data outside the platform. Teams reconcile reports in their own spreadsheets.");
    const sso = mockEmbed("Sign in with company identity. IT manages access with SAML.");
    for (const request of ["Export to Excel", "CSV downloads", "Google Sheets reporting"]) {
      const v = mockEmbed(request);
      expect(cosine(v, exportNeed)).toBeGreaterThan(cosine(v, sso));
    }
  });

  it("normalizes common variants", () => {
    expect(tokenize("Sign-in with Power BI reports")).toEqual(["signin", "powerbi", "report"]);
  });
});
