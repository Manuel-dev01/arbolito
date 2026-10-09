import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
          exclude: ["**/*.fork.test.ts", "**/*.db.test.ts", "**/node_modules/**"],
        },
      },
      {
        // Integration tests against the real Postgres (DATABASE_URL); they clean up after themselves.
        test: {
          name: "db",
          include: ["packages/*/test/**/*.db.test.ts"],
          testTimeout: 30_000,
          fileParallelism: false,
        },
      },
      {
        test: {
          name: "fork",
          include: ["packages/*/test/**/*.fork.test.ts"],
          globalSetup: ["./test/fork-setup.ts"],
          testTimeout: 120_000,
          hookTimeout: 180_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
