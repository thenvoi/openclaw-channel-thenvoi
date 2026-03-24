/**
 * Global test setup for Vitest.
 */

import { vi, beforeEach, afterEach } from "vitest";

// Store original fetch
const originalFetch = globalThis.fetch;

beforeEach(() => {
  // Reset all mocks before each test
  vi.clearAllMocks();

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
