import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 20_000,
    // Integration tests share one local database; run files one at a time.
    fileParallelism: false,
  },
});
