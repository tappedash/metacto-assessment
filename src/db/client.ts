import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

type Db = ReturnType<typeof createDb>;

function createDb() {
  const sql = postgres(getEnv().DATABASE_URL, { max: 5 });
  return Object.assign(drizzle(sql, { schema }), { $sql: sql });
}

// Reuse one pool across Next.js hot reloads in development.
const globalForDb = globalThis as unknown as { __needsHubDb?: Db };

export function getDb(): Db {
  globalForDb.__needsHubDb ??= createDb();
  return globalForDb.__needsHubDb;
}

export async function closeDb(): Promise<void> {
  await globalForDb.__needsHubDb?.$sql.end();
  globalForDb.__needsHubDb = undefined;
}
