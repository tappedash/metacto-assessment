import OpenAI from "openai";
import { getEnv } from "@/lib/env";
import { MockEmbeddingProvider, MockLanguageModel } from "./mock";
import { OpenAIEmbeddingProvider, OpenAILanguageModel } from "./openai";
import type { AiProviders } from "./types";

export type { AiProviders, EmbeddingProvider, LanguageModel } from "./types";

let cached: AiProviders | undefined;

// Picks the implementation from AI_PROVIDER. Domain code receives AiProviders.
export function getAi(): AiProviders {
  if (cached) return cached;
  const env = getEnv();
  if (env.AI_PROVIDER === "openai") {
    const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    cached = {
      llm: new OpenAILanguageModel(client, env.OPENAI_MODEL!, env.AI_RECORD_FIXTURES),
      embeddings: new OpenAIEmbeddingProvider(client, env.OPENAI_EMBEDDING_MODEL!),
    };
  } else {
    cached = { llm: new MockLanguageModel(), embeddings: new MockEmbeddingProvider() };
  }
  return cached;
}
