import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 20_000,
    hookTimeout: 60_000,
    // Suites share one Postgres DB and mutate assignment lifecycle;
    // run files serially to avoid cross-suite races.
    fileParallelism: false,
  },
});
