import { sql } from "drizzle-orm";
import { getAi } from "@/ai";
import { getDb } from "@/db/client";
import { verifySmtp } from "@/lib/mailer";

export const dynamic = "force-dynamic";

// Local readiness check: database + pgvector, AI provider selection, SMTP (Mailpit).
export async function GET() {
  const checks: Record<string, unknown> = {};
  let ok = true;

  try {
    const db = getDb();
    const [ext] = await db.execute<{ extversion: string }>(sql`SELECT extversion FROM pg_extension WHERE extname = 'vector'`);
    const [{ n }] = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM needs`);
    checks.database = { ok: true, pgvector: ext?.extversion ?? null, customerNeeds: n };
    if (!ext) ok = false;
  } catch (error) {
    ok = false;
    checks.database = { ok: false, error: (error as Error).message };
  }

  try {
    const { llm, embeddings } = getAi();
    checks.ai = { ok: true, provider: llm.provider, model: llm.model, embeddingModel: embeddings.model };
  } catch (error) {
    ok = false;
    checks.ai = { ok: false, error: (error as Error).message };
  }

  try {
    await verifySmtp();
    checks.smtp = { ok: true };
  } catch (error) {
    ok = false;
    checks.smtp = { ok: false, error: (error as Error).message };
  }

  return Response.json({ ok, checks }, { status: ok ? 200 : 503 });
}
