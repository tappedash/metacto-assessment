import { loadEnv } from "@/lib/env-loader";
import { sql } from "drizzle-orm";
import { closeDb, getDb } from "./client";

// Drops everything (app tables + Drizzle's migration history) so migrate + seed start clean.
async function main() {
  loadEnv();
  const db = getDb();
  await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  console.log("Database reset.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closeDb);
