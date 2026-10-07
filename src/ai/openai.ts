import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { EMBEDDING_DIMENSIONS } from "@/db/schema";
import { writeFixture } from "./fixtures";
import type { CallOptions, EmbeddingProvider, LanguageModel, StructuredTask, TextTask } from "./types";

// The only module that imports the OpenAI SDK.

export class OpenAILanguageModel implements LanguageModel {
  readonly provider = "openai";

  constructor(private readonly client: OpenAI, readonly model: string, private readonly recordFixtures = false) {}

  async generateStructured<T>(task: StructuredTask<T>, options?: CallOptions): Promise<T> {
    const text = JSON.stringify(task.input);
    const input = task.images?.length
      ? [{
          role: "user" as const,
          content: [
            { type: "input_text" as const, text },
            ...task.images.map((img) => ({ type: "input_image" as const, detail: "auto" as const, image_url: `data:${img.mimeType};base64,${img.dataBase64}` })),
          ],
        }]
      : text;
    const response = await this.client.responses.parse(
      {
        model: this.model,
        instructions: task.instructions,
        input,
        text: { format: zodTextFormat(task.schema as any, task.name) },
      },
      { signal: options?.signal },
    );
    if (response.output_parsed == null) throw new Error(`OpenAI returned no structured output for "${task.name}"`);
    const output = task.schema.parse(response.output_parsed);
    if (this.recordFixtures) writeFixture(task.name, task.input, output);
    return output;
  }

  async generateText(task: TextTask, options?: CallOptions): Promise<string> {
    const response = await this.client.responses.create(
      { model: this.model, instructions: task.instructions, input: JSON.stringify(task.input) },
      { signal: options?.signal },
    );
    if (this.recordFixtures) writeFixture(task.name, task.input, response.output_text);
    return response.output_text;
  }
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly provider = "openai";

  constructor(private readonly client: OpenAI, readonly model: string) {}

  async embed(texts: string[], options?: CallOptions): Promise<number[][]> {
    const response = await this.client.embeddings.create(
      { model: this.model, input: texts, dimensions: EMBEDDING_DIMENSIONS },
      { signal: options?.signal },
    );
    return [...response.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}
