import { EMBEDDING_DIMENSIONS } from "@/db/schema";
import { readFixture } from "./fixtures";
import type { EmbeddingProvider, LanguageModel, StructuredTask, TextTask } from "./types";

// ---------- deterministic embeddings ----------
// Hashing vectorizer + a small demo vocabulary that maps different wordings of the
// same problem to a shared concept (e.g. "Excel", "CSV", "Google Sheets" -> using data
// outside the platform). Good enough for local demos and tests; not a semantic model.
const CONCEPTS: Record<string, string[]> = {
  data_outside_platform: ["excel", "csv", "sheet", "spreadsheet", "export", "download", "report", "kpi", "bi", "powerbi", "reconcile", "audit"],
  company_identity: ["sso", "saml", "okta", "login", "signin", "identity", "provision", "scim", "password", "offboard"],
  shipment_delays: ["delay", "late", "sla", "eta", "slip", "breach", "alert"],
  bulk_rates: ["rate", "carrier", "lane", "bulk", "tariff", "card"],
  dark_mode: ["dark", "theme", "night"],
};
const STOPWORDS = new Set(["a", "an", "the", "to", "of", "for", "and", "or", "in", "on", "our", "we", "i", "my", "it", "is", "are", "be", "with", "as", "so", "can", "need", "needs", "want", "every", "into", "from", "by", "this", "that", "their", "them", "they", "today", "use"]);
const CONCEPT_OF = new Map<string, string>();
for (const [concept, words] of Object.entries(CONCEPTS)) for (const w of words) CONCEPT_OF.set(w, concept);

function stem(word: string): string {
  return word.replace(/(ing|ed|es|s)$/, "") || word;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/sign[\s-]?in/g, "signin")
    .replace(/power\s?bi/g, "powerbi")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    .map(stem);
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function addFeature(vec: number[], feature: string, weight: number): void {
  const h = fnv1a(feature);
  vec[h % vec.length] += (h & 0x80000000 ? -1 : 1) * weight;
}

export function mockEmbed(text: string, dimensions = EMBEDDING_DIMENSIONS): number[] {
  const vec = new Array<number>(dimensions).fill(0);
  for (const token of tokenize(text)) {
    addFeature(vec, `w:${token}`, 1);
    const concept = CONCEPT_OF.get(token);
    if (concept) addFeature(vec, `c:${concept}`, 3);
  }
  const norm = Math.hypot(...vec) || 1;
  return vec.map((v) => v / norm);
}

export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly provider = "mock";
  readonly model = "mock-hashing-v1";
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => mockEmbed(t));
  }
}

// ---------- deterministic language model ----------
type Handler = (input: unknown) => unknown;

// One handler per structured task the app uses. Domain modules register theirs.
const structuredHandlers = new Map<string, Handler>();

export function registerMockHandler(taskName: string, handler: Handler): void {
  structuredHandlers.set(taskName, handler);
}

export class MockLanguageModel implements LanguageModel {
  readonly provider = "mock";
  readonly model = "mock-deterministic-v1";

  async generateStructured<T>(task: StructuredTask<T>): Promise<T> {
    const recorded = readFixture<T>(task.name, task.input);
    if (recorded !== undefined) return task.schema.parse(recorded);
    const handler = structuredHandlers.get(task.name);
    if (!handler) throw new Error(`Mock AI has no handler for task "${task.name}". Register one or record fixtures with AI_PROVIDER=openai AI_RECORD_FIXTURES=true.`);
    return task.schema.parse(handler(task.input));
  }

  async generateText(task: TextTask): Promise<string> {
    const recorded = readFixture<string>(task.name, task.input);
    if (recorded !== undefined) return recorded;
    return `[Mock AI · ${task.name}] ${JSON.stringify(task.input).slice(0, 200)}`;
  }
}
