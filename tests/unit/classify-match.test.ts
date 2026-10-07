import { describe, expect, it } from "vitest";
import { MockLanguageModel } from "@/ai/mock";
import { CLASSIFY_TASK, MatchClassification, RELATED_THRESHOLD, SAME_THRESHOLD } from "@/domain/matching";

const llm = new MockLanguageModel();
const classify = (similarity: number) =>
  llm.generateStructured({
    name: CLASSIFY_TASK,
    instructions: "",
    schema: MatchClassification,
    input: { request: { title: "x" }, candidates: [{ needId: "n1", title: "Need one", problemStatement: "", similarity }] },
  });

describe("mock classify_match", () => {
  it("returns a schema-valid same / related / new decision from similarity", async () => {
    expect((await classify(SAME_THRESHOLD + 0.1)).relation).toBe("same");
    expect((await classify(RELATED_THRESHOLD + 0.05)).relation).toBe("related");
    const created = await classify(RELATED_THRESHOLD - 0.1);
    expect(created).toMatchObject({ relation: "new", needId: null });
  });

  it("explains the match in customer-friendly words", async () => {
    expect((await classify(0.9)).reason).toContain("Need one");
  });
});
