import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration tests hit the real Postgres; run them serially with headroom.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    include: ["tests/**/*.test.ts"],
  },
});
