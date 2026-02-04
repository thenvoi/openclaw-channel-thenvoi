/**
 * E2E Tests: WebSocket Connection
 *
 * Tests the connection flow against a real Thenvoi environment.
 */

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { ThenvoiRuntime, type RuntimeCallbacks } from "../../src/runtime.js";
import { ThenvoiClient } from "../../src/thenvoi-client.js";
import {
  getE2EConfig,
  canRunE2E,
  E2E_SKIP_MESSAGE,
  waitFor,
} from "./setup.js";
import type { ThenvoiConfig } from "../../src/types.js";

describe("E2E: Connection", () => {
  let config: ThenvoiConfig;
  let runtime: ThenvoiRuntime | null = null;

  beforeAll(() => {
    if (!canRunE2E()) {
      return;
    }
    config = getE2EConfig();
  });

  afterEach(async () => {
    if (runtime) {
      await runtime.disconnect();
      runtime = null;
    }
  });

  describe("REST API Authentication", () => {
    it.skipIf(!canRunE2E())(
      "should authenticate and get agent metadata",
      async () => {
        const client = new ThenvoiClient(config);
        const agent = await client.getAgentMe();

        expect(agent).toBeDefined();
        expect(agent.id).toBe(config.agentId);
        expect(agent.name).toBeTruthy();
      },
    );

    it.skipIf(!canRunE2E())(
      "should reject invalid API key",
      async () => {
        const invalidConfig = { ...config, apiKey: "invalid-key" };
        const client = new ThenvoiClient(invalidConfig);

        await expect(client.getAgentMe()).rejects.toThrow(/401|Invalid|Auth/i);
      },
    );
  });

  describe("WebSocket Connection", () => {
    it.skipIf(!canRunE2E())(
      "should connect to WebSocket successfully",
      async () => {
        const callbacks: RuntimeCallbacks = {
          onMessage: () => {},
        };

        runtime = new ThenvoiRuntime(config, callbacks);

        await runtime.connect();

        expect(runtime.isConnected()).toBe(true);
      },
    );

    it.skipIf(!canRunE2E())(
      "should join agent channel on connect",
      async () => {
        let syncCompleted = false;

        const callbacks: RuntimeCallbacks = {
          onMessage: () => {},
          onSyncCompleted: () => {
            syncCompleted = true;
          },
        };

        runtime = new ThenvoiRuntime(config, callbacks);
        await runtime.connect();

        // Sync should complete after connection
        await waitFor(() => syncCompleted || !runtime?.isSyncing(), 5000);

        expect(runtime.isConnected()).toBe(true);
      },
    );

    it.skipIf(!canRunE2E())(
      "should disconnect cleanly",
      async () => {
        const callbacks: RuntimeCallbacks = {
          onMessage: () => {},
        };

        runtime = new ThenvoiRuntime(config, callbacks);
        await runtime.connect();
        expect(runtime.isConnected()).toBe(true);

        await runtime.disconnect();
        expect(runtime.isConnected()).toBe(false);

        // Prevent afterEach from trying to disconnect again
        runtime = null;
      },
    );

    it.skipIf(!canRunE2E())(
      "should reject connection with invalid credentials",
      async () => {
        const invalidConfig = { ...config, apiKey: "invalid-key" };
        const callbacks: RuntimeCallbacks = {
          onMessage: () => {},
          onError: () => {},
        };

        const invalidRuntime = new ThenvoiRuntime(invalidConfig, callbacks);

        await expect(invalidRuntime.connect()).rejects.toThrow();
      },
    );
  });

  describe("Connection State", () => {
    it.skipIf(!canRunE2E())(
      "should report correct connection state",
      async () => {
        const callbacks: RuntimeCallbacks = {
          onMessage: () => {},
        };

        runtime = new ThenvoiRuntime(config, callbacks);

        expect(runtime.isConnected()).toBe(false);
        expect(runtime.isReconnecting()).toBe(false);

        await runtime.connect();

        expect(runtime.isConnected()).toBe(true);
        expect(runtime.isReconnecting()).toBe(false);
      },
    );
  });
});

// Log skip message if env vars not set
if (!canRunE2E()) {
  console.log(`\n${E2E_SKIP_MESSAGE}\n`);
}
