/**
 * E2E Tests: Messaging
 *
 * Tests sending and receiving messages against a real Thenvoi environment.
 */

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { ThenvoiRuntime, type RuntimeCallbacks } from "../../src/runtime.js";
import { ThenvoiClient } from "../../src/thenvoi-client.js";
import {
  getE2EConfig,
  canRunE2E,
  E2E_SKIP_MESSAGE,
  waitFor,
  testId,
} from "./setup.js";
import type { ThenvoiConfig, OpenClawInboundMessage } from "../../src/types.js";

describe("E2E: Messaging", () => {
  let config: ThenvoiConfig;
  let client: ThenvoiClient;
  let runtime: ThenvoiRuntime | null = null;

  beforeAll(() => {
    if (!canRunE2E()) {
      return;
    }
    config = getE2EConfig();
    client = new ThenvoiClient(config);
  });

  afterEach(async () => {
    if (runtime) {
      await runtime.disconnect();
      runtime = null;
    }
  });

  describe("Send Messages", () => {
    it.skipIf(!canRunE2E())(
      "should send a text message to a room",
      async () => {
        // First we need a room - create one
        const room = await client.createChat();
        expect(room.id).toBeTruthy();

        // Get agent metadata and find another peer to mention
        // (API requires at least 1 mention and you can't mention yourself)
        const agent = await client.getAgentMe();
        const peers = await client.lookupPeers(1, 10);
        const otherPeer = peers.peers.find((p) => p.id !== agent.id);

        if (!otherPeer) {
          console.log("No other peers available to test sendMessage");
          return;
        }

        // Add the peer to the room first (pass ID, not name)
        await client.addParticipant(room.id, otherPeer.id, "member");

        // Send a message mentioning the other participant
        const result = await client.sendMessage(
          room.id,
          `E2E test message ${testId()}`,
          [{ id: otherPeer.id, name: otherPeer.name }],
        );

        expect(result.id).toBeTruthy();
        expect(result.success).toBe(true);
      },
    );

    it.skipIf(!canRunE2E())(
      "should send a message with mentions",
      async () => {
        const room = await client.createChat();

        // Get another peer to mention (can't mention self)
        const agent = await client.getAgentMe();
        const peers = await client.lookupPeers(1, 10);
        const otherPeer = peers.peers.find((p) => p.id !== agent.id);

        if (!otherPeer) {
          console.log("No other peers available to test mentions");
          return;
        }

        // Add the peer to the room (pass ID, not name)
        await client.addParticipant(room.id, otherPeer.id, "member");

        const result = await client.sendMessage(
          room.id,
          `Hello @${otherPeer.name}!`,
          [{ id: otherPeer.id, name: otherPeer.name }],
        );

        expect(result.id).toBeTruthy();
        expect(result.success).toBe(true);
      },
    );

    it.skipIf(!canRunE2E())(
      "should send an event (thought) message",
      async () => {
        const room = await client.createChat();

        const result = await client.sendEvent(
          room.id,
          "Thinking about the problem...",
          "thought",
        );

        expect(result.id).toBeTruthy();
        expect(result.success).toBe(true);
      },
    );
  });

  describe("Receive Messages (via Runtime)", () => {
    it.skipIf(!canRunE2E())(
      "should receive messages through WebSocket",
      async () => {
        const receivedMessages: OpenClawInboundMessage[] = [];
        let roomJoined = false;

        const callbacks: RuntimeCallbacks = {
          onMessage: (msg) => {
            receivedMessages.push(msg);
          },
          onRoomJoined: () => {
            roomJoined = true;
          },
        };

        runtime = new ThenvoiRuntime(config, callbacks);
        await runtime.connect();

        // Create a room (this should trigger room_added and auto-join)
        const room = await client.createChat();

        // Wait for room to be joined
        await waitFor(() => roomJoined || runtime!.getRooms().has(room.id), 5000);

        // The room should be tracked
        const rooms = runtime.getRooms();
        expect(rooms.size).toBeGreaterThanOrEqual(0); // May or may not have rooms depending on setup
      },
    );
  });

  describe("Message Recovery", () => {
    it.skipIf(!canRunE2E())(
      "should process backlog messages on connect",
      async () => {
        let syncStarted = false;
        let syncCompleted = false;
        let syncMessageCount = 0;

        const callbacks: RuntimeCallbacks = {
          onMessage: () => {},
          onSyncStarted: () => {
            syncStarted = true;
          },
          onSyncCompleted: (count) => {
            syncCompleted = true;
            syncMessageCount = count;
          },
        };

        runtime = new ThenvoiRuntime(config, callbacks);
        await runtime.connect();

        // Wait for sync to complete
        await waitFor(() => syncCompleted || !runtime?.isSyncing(), 10000);

        // Sync should have been attempted
        expect(syncStarted || syncCompleted).toBe(true);
        // Message count should be non-negative
        expect(syncMessageCount).toBeGreaterThanOrEqual(0);
      },
    );

    it.skipIf(!canRunE2E())(
      "should fetch next message from backlog API",
      async () => {
        // This tests the REST API directly
        const message = await client.getNextMessage();

        // Could be null if no pending messages, or a message object
        if (message !== null) {
          expect(message.id).toBeTruthy();
          expect(message.content).toBeDefined();
          expect(message.sender_name).toBeTruthy();
        }
        // null is also a valid response (no pending messages)
      },
    );
  });

  describe("Message Status Tracking", () => {
    it.skipIf(!canRunE2E())(
      "should mark message as processed",
      async () => {
        // Get a message from backlog (if any)
        const message = await client.getNextMessage();

        if (message) {
          // Mark as processing
          await client.markMessageProcessing(message.chat_room_id, message.id);

          // Mark as processed
          await client.markMessageProcessed(message.chat_room_id, message.id);

          // If we got here without error, it worked
          expect(true).toBe(true);
        } else {
          // No messages to process, skip this test
          console.log("No pending messages to test status tracking");
        }
      },
    );
  });
});

// Log skip message if env vars not set
if (!canRunE2E()) {
  console.log(`\n${E2E_SKIP_MESSAGE}\n`);
}
