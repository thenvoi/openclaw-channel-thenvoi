/**
 * E2E Tests: MCP Tools (via ThenvoiClient)
 *
 * Tests the underlying API calls that power the MCP tools.
 * These tests call ThenvoiClient directly since MCP tools
 * require the channel to be initialized.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ThenvoiClient } from "../../src/thenvoi-client.js";
import {
  getE2EConfig,
  canRunE2E,
  E2E_SKIP_MESSAGE,
  testId,
} from "./setup.js";
import type { ThenvoiConfig } from "../../src/types.js";

describe("E2E: MCP Tools (API)", () => {
  let config: ThenvoiConfig;
  let client: ThenvoiClient;
  let testRoomId: string | null = null;

  beforeAll(() => {
    if (!canRunE2E()) {
      return;
    }
    config = getE2EConfig();
    client = new ThenvoiClient(config);
  });

  afterAll(async () => {
    // Cleanup: We don't have a delete room API, so rooms will persist
    // In a real test environment, you'd clean up test data
  });

  describe("thenvoi_lookup_peers", () => {
    it.skipIf(!canRunE2E())(
      "should return list of peers",
      async () => {
        const result = await client.lookupPeers(1, 10);

        expect(result).toBeDefined();
        expect(result.peers).toBeInstanceOf(Array);
        expect(result.page).toBe(1);
        expect(result.page_size).toBe(10);
        expect(typeof result.total_count).toBe("number");
        expect(typeof result.has_more).toBe("boolean");

        // If there are peers, check their structure
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
        const page1 = await client.lookupPeers(1, 5);
        const page2 = await client.lookupPeers(2, 5);

        expect(page1.page).toBe(1);
        expect(page2.page).toBe(2);

        // If there are enough peers, pages should be different
        if (page1.has_more && page2.peers.length > 0) {
          expect(page1.peers[0]?.id).not.toBe(page2.peers[0]?.id);
        }
      },
    );
  });

  describe("thenvoi_create_chatroom", () => {
    it.skipIf(!canRunE2E())(
      "should create a new chatroom",
      async () => {
        const result = await client.createChat();

        expect(result).toBeDefined();
        expect(result.id).toBeTruthy();

        // Save for later tests
        testRoomId = result.id;
      },
    );

    it.skipIf(!canRunE2E())(
      "should create chatroom without task_id",
      async () => {
        const result = await client.createChat();

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
          const room = await client.createChat();
          testRoomId = room.id;
        }

        const participants = await client.getParticipants(testRoomId);

        expect(participants).toBeInstanceOf(Array);

        // The creating agent should be a participant
        if (participants.length > 0) {
          const participant = participants[0];
          expect(participant.id).toBeTruthy();
          expect(participant.name).toBeTruthy();
          expect(participant.role).toBeTruthy();
        }
      },
    );
  });

  describe("thenvoi_add_participant", () => {
    it.skipIf(!canRunE2E())(
      "should add a participant to a room",
      async () => {
        // Create a fresh room for this test
        const room = await client.createChat();

        // Get a peer to add (from lookup)
        const peers = await client.lookupPeers(1, 10);

        // Find a peer that's not us
        const agent = await client.getAgentMe();
        const otherPeer = peers.peers.find((p) => p.id !== agent.id);

        if (otherPeer) {
          const result = await client.addParticipant(
            room.id,
            otherPeer.id,
            "member",
          );

          expect(result).toBeDefined();
          expect(result.name).toBe(otherPeer.name);
          expect(result.role).toBe("member");
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
        const room = await client.createChat();

        // Get peers and add one
        const peers = await client.lookupPeers(1, 10);
        const agent = await client.getAgentMe();
        const otherPeer = peers.peers.find((p) => p.id !== agent.id);

        if (otherPeer) {
          // Add participant
          await client.addParticipant(room.id, otherPeer.id, "member");

          // Remove participant
          await client.removeParticipant(room.id, otherPeer.id);

          // Verify they're gone
          const participants = await client.getParticipants(room.id);
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
        const room = await client.createChat();

        const result = await client.sendEvent(
          room.id,
          "Processing the request...",
          "thought",
        );

        expect(result.id).toBeTruthy();
        expect(result.success).toBe(true);
      },
    );

    it.skipIf(!canRunE2E())(
      "should send an error event",
      async () => {
        const room = await client.createChat();

        const result = await client.sendEvent(
          room.id,
          "Something went wrong: Test error",
          "error",
        );

        expect(result.id).toBeTruthy();
        expect(result.success).toBe(true);
      },
    );

    it.skipIf(!canRunE2E())(
      "should send a task event",
      async () => {
        const room = await client.createChat();

        const result = await client.sendEvent(
          room.id,
          "Starting data analysis task",
          "task",
        );

        expect(result.id).toBeTruthy();
        expect(result.success).toBe(true);
      },
    );
  });
});

// Log skip message if env vars not set
if (!canRunE2E()) {
  console.log(`\n${E2E_SKIP_MESSAGE}\n`);
}
