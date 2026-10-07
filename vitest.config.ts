import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["packages/*/test/**/*.test.ts"],
          exclude: ["**/*.fork.test.ts", "**/node_modules/**"],
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
