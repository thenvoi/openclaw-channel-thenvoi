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
    process.env.THENVOI_WS_URL ?? "wss://app.thenvoi.com/api/v1/socket";
  const restUrl = process.env.THENVOI_REST_URL ?? "https://app.thenvoi.com";

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

// =============================================================================
// Direct REST helpers for endpoints not yet supported by the SDK's Fern client.
// These call the Thenvoi API directly using fetch.
// =============================================================================

/**
 * Direct fetch wrapper for the Thenvoi agent REST API.
 * Used as a workaround for endpoints missing from the SDK's Fern client.
 */
export async function agentApiFetch(
  config: E2EConfig,
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<unknown> {
  const url = `${config.restUrl}/api/v1${path}`;
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      "X-API-Key": config.apiKey,
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API ${response.status}: ${text.slice(0, 200)}`);
  }
  return response.json();
}

/**
 * Get agent identity via direct API call (bypasses Fern client).
 */
export async function getAgentMe(config: E2EConfig): Promise<{ id: string; name: string; handle?: string }> {
  const data = await agentApiFetch(config, "/agent/me") as { data: { id: string; name: string; handle?: string } };
  return data.data;
}

/**
 * Lookup peers via direct API call (bypasses Fern client).
 */
export async function lookupPeers(config: E2EConfig, page = 1, pageSize = 50): Promise<{ peers: Array<{ id: string; name: string; type: string; handle?: string; description?: string }>; metadata: Record<string, unknown> }> {
  const response = await agentApiFetch(config, `/agent/peers?page=${page}&page_size=${pageSize}`) as Record<string, unknown>;
  const peers = (response.data ?? []) as Array<{ id: string; name: string; type: string; handle?: string; description?: string }>;
  const metadata = (response.meta ?? response.metadata ?? { page, pageSize }) as Record<string, unknown>;
  return { peers, metadata };
}

/**
 * Create a chat room via direct API call (bypasses Fern client).
 */
export async function createChat(config: E2EConfig, taskId?: string): Promise<{ id: string }> {
  const chat: Record<string, unknown> = {};
  if (taskId) chat.task_id = taskId;
  const response = (await agentApiFetch(config, "/agent/chats", { method: "POST", body: { chat } })) as Record<string, unknown>;
  // API returns { data: { id, ... } }
  const data = (response.data ?? response) as { id: string };
  return data;
}

/**
 * Send a message via direct API call (bypasses Fern client).
 */
export async function sendMessage(
  config: E2EConfig,
  roomId: string,
  content: string,
  mentions: Array<{ id: string; name: string }>,
): Promise<{ id: string }> {
  // Uses /chats/ path — matching the Fern client's endpoint
  const url = `${config.restUrl}/api/v1/chats/${roomId}/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "X-API-Key": config.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message: { content, mentions } }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API ${response.status}: ${text.slice(0, 200)}`);
  }
  return (await response.json()) as { id: string };
}

/**
 * Add a participant to a room via direct API call (bypasses Fern client).
 */
export async function addParticipant(
  config: E2EConfig,
  roomId: string,
  participantId: string,
  role = "member",
): Promise<unknown> {
  // Uses /chats/ path (not /agent/chats/) — matching the Fern client's endpoint
  const url = `${config.restUrl}/api/v1/chats/${roomId}/participants`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "X-API-Key": config.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ participant: { participant_id: participantId, role } }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API ${response.status}: ${text.slice(0, 200)}`);
  }
  return response.json();
}
