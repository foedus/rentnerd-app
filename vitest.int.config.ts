import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.int.test.ts"],
    passWithNoTests: true,
    testTimeout: 30_000,
    fileParallelism: false,
  },
});
