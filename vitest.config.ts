import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["src/**/*.int.test.ts", "node_modules/**"],
    passWithNoTests: true,
  },
});
