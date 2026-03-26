/**
 * Global test setup for Vitest.
 */

import { readFileSync } from "node:fs";
import { vi, beforeEach, afterEach } from "vitest";

// Store original fetch
const originalFetch = globalThis.fetch;

// Reset the gateway registry directly via globalThis to avoid importing
// channel.ts before test-level vi.mock() calls have been hoisted.
// Read the version from package.json so we don't hardcode it in two places.
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as { version: string };
const GATEWAY_REGISTRY_KEY = `__thenvoi_gateway_registry_v${pkg.version}__`;

beforeEach(() => {
  // Reset all mocks before each test
  vi.clearAllMocks();

  // Reset gateway registry to prevent state leaking between tests
  delete (globalThis as unknown as Record<string, unknown>)[GATEWAY_REGISTRY_KEY];

  // Reset environment variables
  delete process.env.THENVOI_API_KEY;
  delete process.env.THENVOI_AGENT_ID;
  delete process.env.THENVOI_WS_URL;
  delete process.env.THENVOI_REST_URL;
});

afterEach(() => {
  // Restore original fetch
  globalThis.fetch = originalFetch;
});
