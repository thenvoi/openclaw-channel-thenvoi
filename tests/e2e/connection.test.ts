/**
 * E2E Tests: WebSocket Connection
 *
 * Tests the connection flow against a real Thenvoi environment.
 * Uses ThenvoiLink from @thenvoi/sdk and RoomPresence from @thenvoi/sdk/runtime.
 */

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { ThenvoiLink } from "@thenvoi/sdk";
import { RoomPresence } from "@thenvoi/sdk/runtime";
import {
  getE2EConfig,
  canRunE2E,
  E2E_SKIP_MESSAGE,
  waitFor,
} from "./setup.js";
import type { E2EConfig } from "./setup.js";

describe("E2E: Connection", () => {
  let config: E2EConfig;
  let link: ThenvoiLink | null = null;
  let presence: RoomPresence | null = null;

  beforeAll(() => {
    if (!canRunE2E()) {
      return;
    }
    config = getE2EConfig();
  });

  afterEach(async () => {
    if (presence) {
      await presence.stop();
      presence = null;
    }
    if (link) {
      await link.disconnect();
      link = null;
    }
  });

  describe("REST API Authentication", () => {
    it.skipIf(!canRunE2E())(
      "should authenticate and get agent metadata",
      async () => {
        link = new ThenvoiLink({
          agentId: config.agentId,
          apiKey: config.apiKey,
          wsUrl: config.wsUrl,
          restUrl: config.restUrl,
        });
        const agent = await link.rest.getAgentMe();

        expect(agent).toBeDefined();
        expect(agent.id).toBe(config.agentId);
        expect(agent.name).toBeTruthy();
      },
    );

    it.skipIf(!canRunE2E())(
      "should reject invalid API key",
      async () => {
        const invalidLink = new ThenvoiLink({
          agentId: config.agentId,
          apiKey: "invalid-key",
          wsUrl: config.wsUrl,
          restUrl: config.restUrl,
        });

        await expect(invalidLink.rest.getAgentMe()).rejects.toThrow(/401|Invalid|Auth/i);
      },
    );
  });

  describe("WebSocket Connection", () => {
    it.skipIf(!canRunE2E())(
      "should connect to WebSocket successfully",
      async () => {
        link = new ThenvoiLink({
          agentId: config.agentId,
          apiKey: config.apiKey,
          wsUrl: config.wsUrl,
          restUrl: config.restUrl,
        });

        await link.connect();

        expect(link.isConnected()).toBe(true);
      },
    );

    it.skipIf(!canRunE2E())(
      "should join agent channel on connect",
      async () => {
        let roomJoined = false;

        link = new ThenvoiLink({
          agentId: config.agentId,
          apiKey: config.apiKey,
          wsUrl: config.wsUrl,
          restUrl: config.restUrl,
        });
        await link.connect();

        presence = new RoomPresence({
          link,
          autoSubscribeExistingRooms: true,
        });

        presence.onRoomJoined = async () => {
          roomJoined = true;
        };

        await presence.start();

        // Wait for presence to subscribe to existing rooms
        await waitFor(() => roomJoined || presence!.rooms.size > 0, 5000);

        expect(link.isConnected()).toBe(true);
      },
    );

    it.skipIf(!canRunE2E())(
      "should disconnect cleanly",
      async () => {
        link = new ThenvoiLink({
          agentId: config.agentId,
          apiKey: config.apiKey,
          wsUrl: config.wsUrl,
          restUrl: config.restUrl,
        });
        await link.connect();
        expect(link.isConnected()).toBe(true);

        await link.disconnect();
        expect(link.isConnected()).toBe(false);

        // Prevent afterEach from trying to disconnect again
        link = null;
      },
    );

    it.skipIf(!canRunE2E())(
      "should reject connection with invalid credentials",
      async () => {
        const invalidLink = new ThenvoiLink({
          agentId: config.agentId,
          apiKey: "invalid-key",
          wsUrl: config.wsUrl,
          restUrl: config.restUrl,
        });

        await expect(invalidLink.connect()).rejects.toThrow();
      },
    );
  });

  describe("Connection State", () => {
    it.skipIf(!canRunE2E())(
      "should report correct connection state",
      async () => {
        link = new ThenvoiLink({
          agentId: config.agentId,
          apiKey: config.apiKey,
          wsUrl: config.wsUrl,
          restUrl: config.restUrl,
        });

        expect(link.isConnected()).toBe(false);

        await link.connect();

        expect(link.isConnected()).toBe(true);
      },
    );
  });
});

// Log skip message if env vars not set
if (!canRunE2E()) {
  console.log(`\n${E2E_SKIP_MESSAGE}\n`);
}
