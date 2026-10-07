import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Record/replay: real OpenAI outputs saved here are replayed by the mock provider.
const FIXTURE_DIR = join(process.cwd(), "fixtures", "ai");

function fixturePath(taskName: string, input: unknown): string {
  const hash = createHash("sha256").update(taskName).update(JSON.stringify(input)).digest("hex").slice(0, 16);
  return join(FIXTURE_DIR, `${taskName}-${hash}.json`);
}

export function readFixture<T>(taskName: string, input: unknown): T | undefined {
  const path = fixturePath(taskName, input);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")).output as T;
}

export function writeFixture(taskName: string, input: unknown, output: unknown): void {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  writeFileSync(fixturePath(taskName, input), JSON.stringify({ task: taskName, input, output }, null, 2) + "\n");
}
