import { z } from "zod";
import { getAi } from "@/ai";
import { getDb } from "@/db/client";
import { matchRequest } from "@/domain/matching";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

const Body = z.object({
  title: z.string().trim().min(3).max(200),
  why: z.string().trim().max(2000).optional(),
});

// Synchronous matching path used on submission. Skeleton: does not persist the request yet.
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Expected { title: string (3-200 chars), why?: string }" }, { status: 400 });
  }
  const result = await matchRequest(parsed.data, { db: getDb(), ai: getAi(), timeoutMs: getEnv().MATCH_TIMEOUT_MS });
  return Response.json(result);
}
