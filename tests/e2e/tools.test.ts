/**
 * E2E Tests: MCP Tools (via ThenvoiLink REST API)
 *
 * Tests the underlying API calls that power the MCP tools.
 * Uses direct API helpers for endpoints not yet supported by the SDK's Fern client.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ThenvoiLink } from "@thenvoi/sdk";
import {
  getE2EConfig,
  canRunE2E,
  E2E_SKIP_MESSAGE,
  getAgentMe,
  lookupPeers,
  createChat,
  addParticipant,
} from "./setup.js";
import type { E2EConfig } from "./setup.js";

describe("E2E: MCP Tools (API)", () => {
  let config: E2EConfig;
  let link: ThenvoiLink;
  let testRoomId: string | null = null;

  beforeAll(() => {
    if (!canRunE2E()) {
      return;
    }
    config = getE2EConfig();
    link = new ThenvoiLink({
      agentId: config.agentId,
      apiKey: config.apiKey,
      wsUrl: config.wsUrl,
      restUrl: config.restUrl,
    });
  });

  afterAll(async () => {
    // Cleanup: We don't have a delete room API, so rooms will persist
  });

  describe("thenvoi_lookup_peers", () => {
    it.skipIf(!canRunE2E())(
      "should return list of peers",
      async () => {
        const result = await lookupPeers(config, 1, 10);

        expect(result).toBeDefined();
        expect(result.peers).toBeInstanceOf(Array);

        if (result.peers.length > 0) {
          const peer = result.peers[0];
          expect(peer.id).toBeTruthy();
          expect(peer.name).toBeTruthy();
          expect(["User", "Agent", "System"]).toContain(peer.type);
        }
      },
    );

    it.skipIf(!canRunE2E())(
      "should support pagination",
      async () => {
        const page1 = await lookupPeers(config, 1, 5);
        const page2 = await lookupPeers(config, 2, 5);

        expect(page1.metadata).toBeDefined();
        expect(page2.metadata).toBeDefined();

        if (page2.peers.length > 0) {
          expect(page1.peers[0]?.id).not.toBe(page2.peers[0]?.id);
        }
      },
    );
  });

  describe("thenvoi_create_chatroom", () => {
    it.skipIf(!canRunE2E())(
      "should create a new chatroom",
      async () => {
        const result = await createChat(config);

        expect(result).toBeDefined();
        expect(result.id).toBeTruthy();

        testRoomId = result.id;
      },
    );

    it.skipIf(!canRunE2E())(
      "should create chatroom without task_id",
      async () => {
        const result = await createChat(config);

        expect(result).toBeDefined();
        expect(result.id).toBeTruthy();
      },
    );
  });

  describe("thenvoi_get_participants", () => {
    it.skipIf(!canRunE2E())(
      "should get participants in a room",
      async () => {
        if (!testRoomId) {
          const room = await createChat(config);
          testRoomId = room.id;
        }

        const participants = await link.rest.listChatParticipants(testRoomId);

        expect(participants).toBeInstanceOf(Array);

        if (participants.length > 0) {
          const participant = participants[0];
          expect(participant.id).toBeTruthy();
          expect(participant.name).toBeTruthy();
        }
      },
    );
  });

  describe("thenvoi_add_participant", () => {
    it.skipIf(!canRunE2E())(
      "should add a participant to a room",
      async () => {
        const room = await createChat(config);

        const { peers } = await lookupPeers(config, 1, 10);
        const agent = await getAgentMe(config);
        const otherPeer = peers.find((p) => p.id !== agent.id);

        if (otherPeer) {
          const result = await addParticipant(config, room.id, otherPeer.id, "member");
          expect(result).toBeDefined();
        } else {
          console.log("No other peers available to test add_participant");
        }
      },
    );
  });

  describe("thenvoi_remove_participant", () => {
    it.skipIf(!canRunE2E())(
      "should remove a participant from a room",
      async () => {
        const room = await createChat(config);

        const { peers } = await lookupPeers(config, 1, 10);
        const agent = await getAgentMe(config);
        const otherPeer = peers.find((p) => p.id !== agent.id);

        if (otherPeer) {
          await addParticipant(config, room.id, otherPeer.id, "member");

          await link.rest.removeChatParticipant(room.id, otherPeer.id);

          const participants = await link.rest.listChatParticipants(room.id);
          const stillThere = participants.find((p) => p.name === otherPeer.name);
          expect(stillThere).toBeUndefined();
        } else {
          console.log("No other peers available to test remove_participant");
        }
      },
    );
  });

  describe("thenvoi_send_event", () => {
    it.skipIf(!canRunE2E())(
      "should send a thought event",
      async () => {
        const room = await createChat(config);

        const result = await link.rest.createChatEvent(
          room.id,
          {
            content: "Processing the request...",
            messageType: "thought",
          },
        );

        expect(result).toBeDefined();
      },
    );

    it.skipIf(!canRunE2E())(
      "should send an error event",
      async () => {
        const room = await createChat(config);

        const result = await link.rest.createChatEvent(
          room.id,
          {
            content: "Something went wrong: Test error",
            messageType: "error",
          },
        );

        expect(result).toBeDefined();
      },
    );

    it.skipIf(!canRunE2E())(
      "should send a task event",
      async () => {
        const room = await createChat(config);

        const result = await link.rest.createChatEvent(
          room.id,
          {
            content: "Starting data analysis task",
            messageType: "task",
          },
        );

        expect(result).toBeDefined();
      },
    );
  });
});

// Log skip message if env vars not set
if (!canRunE2E()) {
  console.log(`\n${E2E_SKIP_MESSAGE}\n`);
}
