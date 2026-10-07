import type { z } from "zod";

// Domain services depend only on these interfaces, never on a vendor SDK.

export interface CallOptions {
  signal?: AbortSignal;
}

export interface EmbeddingProvider {
  readonly provider: string;
  readonly model: string;
  embed(texts: string[], options?: CallOptions): Promise<number[][]>;
}

export interface ImageInput {
  mimeType: string;
  dataBase64: string;
}

export interface StructuredTask<T> {
  /** Stable task name, e.g. "classify_match". Used as the schema name and fixture key. */
  name: string;
  instructions: string;
  input: unknown;
  schema: z.ZodType<T>;
  /** Optional images (e.g. screenshots) for providers that can look at them. */
  images?: ImageInput[];
}

export interface TextTask {
  name: string;
  instructions: string;
  input: unknown;
}

export interface LanguageModel {
  readonly provider: string;
  readonly model: string;
  generateStructured<T>(task: StructuredTask<T>, options?: CallOptions): Promise<T>;
  generateText(task: TextTask, options?: CallOptions): Promise<string>;
}

export interface AiProviders {
  llm: LanguageModel;
  embeddings: EmbeddingProvider;
}
