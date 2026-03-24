/**
 * E2E Test Setup and Utilities
 *
 * Provides helpers for running tests against a real Thenvoi environment.
 * Requires THENVOI_API_KEY, THENVOI_AGENT_ID, and THENVOI_API_KEY_USER environment variables.
 */

/**
 * Configuration shape for E2E tests, matching ThenvoiLink constructor options.
 */
export interface E2EConfig {
  apiKey: string;
  agentId: string;
  userId: string;
  wsUrl: string;
  restUrl: string;
}

/**
 * Get E2E test configuration from environment variables.
 * Throws if required variables are not set.
 */
export function getE2EConfig(): E2EConfig {
  const apiKey = process.env.THENVOI_API_KEY;
  const agentId = process.env.THENVOI_AGENT_ID;
  const userId = process.env.THENVOI_API_KEY_USER;
  const wsUrl =
    process.env.THENVOI_WS_URL ?? "wss://api.thenvoi.com/socket/websocket";
  const restUrl = process.env.THENVOI_REST_URL ?? "https://api.thenvoi.com";

  if (!apiKey) {
    throw new Error(
      "E2E tests require THENVOI_API_KEY environment variable. " +
        "Set it to run tests against a real Thenvoi environment.",
    );
  }

  if (!agentId) {
    throw new Error(
      "E2E tests require THENVOI_AGENT_ID environment variable. " +
        "Set it to run tests against a real Thenvoi environment.",
    );
  }

  if (!userId) {
    throw new Error(
      "E2E tests require THENVOI_API_KEY_USER environment variable. " +
        "Set it to run tests against a real Thenvoi environment.",
    );
  }

  return { apiKey, agentId, userId, wsUrl, restUrl };
}

/**
 * Check if E2E tests can run (env vars are set).
 */
export function canRunE2E(): boolean {
  return !!(
    process.env.THENVOI_API_KEY &&
    process.env.THENVOI_AGENT_ID &&
    process.env.THENVOI_API_KEY_USER
  );
}

/**
 * Skip message for when E2E env vars are not configured.
 */
export const E2E_SKIP_MESSAGE =
  "Skipping E2E test: THENVOI_API_KEY, THENVOI_AGENT_ID, and THENVOI_API_KEY_USER not set";

/**
 * Helper to wait for a condition with timeout.
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs: number = 10000,
  intervalMs: number = 100,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await condition()) {
      return;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timeout waiting for condition after ${timeoutMs}ms`);
}

/**
 * Sleep for a given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate a unique test identifier for isolation.
 */
export function testId(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
