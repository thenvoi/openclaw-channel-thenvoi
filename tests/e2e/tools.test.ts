/**
 * E2E Tests: MCP Tools (via ThenvoiLink REST API)
 *
 * Tests the underlying API calls that power the MCP tools.
 * These tests call ThenvoiLink.rest directly since MCP tools
 * require the channel to be initialized.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ThenvoiLink } from "@thenvoi/sdk";
import {
  getE2EConfig,
  canRunE2E,
  E2E_SKIP_MESSAGE,
  testId,
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
    // In a real test environment, you'd clean up test data
  });

  describe("thenvoi_lookup_peers", () => {
    it.skipIf(!canRunE2E())(
      "should return list of peers",
      async () => {
        const result = await link.rest.listPeers!({ page: 1, pageSize: 10, notInChat: "" });

        expect(result).toBeDefined();
        expect(result.data).toBeInstanceOf(Array);
        expect(result.metadata).toBeDefined();

        // If there are peers, check their structure
        if (result.data.length > 0) {
          const peer = result.data[0];
          expect(peer.id).toBeTruthy();
          expect(peer.name).toBeTruthy();
          expect(["User", "Agent", "System"]).toContain(peer.type);
        }
      },
    );

    it.skipIf(!canRunE2E())(
      "should support pagination",
      async () => {
        const page1 = await link.rest.listPeers!({ page: 1, pageSize: 5, notInChat: "" });
        const page2 = await link.rest.listPeers!({ page: 2, pageSize: 5, notInChat: "" });

        expect(page1.metadata).toBeDefined();
        expect(page2.metadata).toBeDefined();

        // If there are enough peers, pages should be different
        if (page2.data.length > 0) {
          expect(page1.data[0]?.id).not.toBe(page2.data[0]?.id);
        }
      },
    );
  });

  describe("thenvoi_create_chatroom", () => {
    it.skipIf(!canRunE2E())(
      "should create a new chatroom",
      async () => {
        const result = await link.rest.createChat();

        expect(result).toBeDefined();
        expect(result.id).toBeTruthy();

        // Save for later tests
        testRoomId = result.id;
      },
    );

    it.skipIf(!canRunE2E())(
      "should create chatroom without task_id",
      async () => {
        const result = await link.rest.createChat();

        expect(result).toBeDefined();
        expect(result.id).toBeTruthy();
      },
    );
  });

  describe("thenvoi_get_participants", () => {
    it.skipIf(!canRunE2E())(
      "should get participants in a room",
      async () => {
        // Create a room first if we don't have one
        if (!testRoomId) {
          const room = await link.rest.createChat();
          testRoomId = room.id;
        }

        const participants = await link.rest.listChatParticipants(testRoomId);

        expect(participants).toBeInstanceOf(Array);

        // The creating agent should be a participant
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
        // Create a fresh room for this test
        const room = await link.rest.createChat();

        // Get a peer to add (from lookup)
        const peers = await link.rest.listPeers!({ page: 1, pageSize: 10, notInChat: "" });

        // Find a peer that's not us
        const agent = await link.rest.getAgentMe();
        const otherPeer = peers.data.find((p) => p.id !== agent.id);

        if (otherPeer) {
          const result = await link.rest.addChatParticipant(
            room.id,
            { participantId: otherPeer.id!, role: "member" },
          );

          expect(result).toBeDefined();
        } else {
          // No other peers available, skip this specific assertion
          console.log("No other peers available to test add_participant");
        }
      },
    );
  });

  describe("thenvoi_remove_participant", () => {
    it.skipIf(!canRunE2E())(
      "should remove a participant from a room",
      async () => {
        // Create a room and add a participant
        const room = await link.rest.createChat();

        // Get peers and add one
        const peers = await link.rest.listPeers!({ page: 1, pageSize: 10, notInChat: "" });
        const agent = await link.rest.getAgentMe();
        const otherPeer = peers.data.find((p) => p.id !== agent.id);

        if (otherPeer) {
          // Add participant
          await link.rest.addChatParticipant(room.id, { participantId: otherPeer.id!, role: "member" });

          // Remove participant
          await link.rest.removeChatParticipant(room.id, otherPeer.id!);

          // Verify they're gone
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
        const room = await link.rest.createChat();

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
        const room = await link.rest.createChat();

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
        const room = await link.rest.createChat();

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
