import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Derive SDK optional peer deps so E2E tests can stub them (they aren't installed).
const sdkPkg = JSON.parse(readFileSync("node_modules/@thenvoi/sdk/package.json", "utf-8"));
const sdkPeerMeta: Record<string, { optional?: boolean }> = sdkPkg.peerDependenciesMeta ?? {};
const optionalPeers = Object.keys(sdkPeerMeta).filter((dep) => sdkPeerMeta[dep].optional);

// Build alias map: each optional peer → a virtual empty module
const stubAliases: Record<string, string> = {};
for (const peer of optionalPeers) {
  stubAliases[peer] = new URL("tests/__mocks__/empty-module.ts", import.meta.url).pathname;
}

export default defineConfig({
  resolve: {
    alias: stubAliases,
  },
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
