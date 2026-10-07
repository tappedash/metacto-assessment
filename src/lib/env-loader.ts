// Loads .env for scripts that run outside Next.js (Drizzle Kit, seed, tests).
// Next.js loads .env itself. Missing .env is fine: variables may come from the shell.
export function loadEnv(path = ".env"): void {
  try {
    process.loadEnvFile(path);
  } catch {
    // no .env file
  }
}
