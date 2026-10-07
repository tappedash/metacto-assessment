import { z } from "zod";

const schema = z
  .object({
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required (see .env.example)"),
    AI_PROVIDER: z.enum(["mock", "openai"]).default("mock"),
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_MODEL: z.string().optional(),
    OPENAI_EMBEDDING_MODEL: z.string().optional(),
    AI_RECORD_FIXTURES: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    SMTP_HOST: z.string().default("localhost"),
    SMTP_PORT: z.coerce.number().int().positive().default(1025),
    MAIL_FROM: z.string().default("Needs Hub <updates@needs-hub.local>"),
    MATCH_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  })
  .superRefine((env, ctx) => {
    if (env.AI_PROVIDER !== "openai") return;
    for (const key of ["OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_EMBEDDING_MODEL"] as const) {
      if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: `${key} is required when AI_PROVIDER=openai` });
    }
  });

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

// Validated lazily so `next build` does not need a database URL.
export function getEnv(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
      throw new Error(`Invalid environment configuration:\n${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}
