import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts", "packages/*/tests/**/*.test.ts", "packages/*/src/**/*.test.ts"],
  },
});
