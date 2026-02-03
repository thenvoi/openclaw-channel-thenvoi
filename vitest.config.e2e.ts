import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/e2e/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
    testTimeout: 30000,
    hookTimeout: 30000,
    // E2E tests run sequentially to avoid race conditions
    sequence: {
      concurrent: false,
    },
    // Bail on first failure for E2E (faster feedback)
    bail: 1,
  },
});
