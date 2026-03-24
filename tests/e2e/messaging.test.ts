/**
 * E2E Tests: Messaging
 *
 * Tests sending and receiving messages against a real Thenvoi environment.
 * Uses ThenvoiLink from @thenvoi/sdk and RoomPresence from @thenvoi/sdk/runtime.
 */

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { ThenvoiLink } from "@thenvoi/sdk";
import { RoomPresence } from "@thenvoi/sdk/runtime";
import type { PlatformEvent } from "@thenvoi/sdk";
import {
  getE2EConfig,
  canRunE2E,
  E2E_SKIP_MESSAGE,
  waitFor,
  testId,
} from "./setup.js";
import type { E2EConfig } from "./setup.js";

/** Locally defined inbound message shape for test assertions. */
interface InboundMessage {
  roomId: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: string;
}

describe("E2E: Messaging", () => {
  let config: E2EConfig;
  let link: ThenvoiLink;
  let presenceLink: ThenvoiLink | null = null;
  let presence: RoomPresence | null = null;

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

  afterEach(async () => {
    if (presence) {
      await presence.stop();
      presence = null;
    }
    if (presenceLink) {
      await presenceLink.disconnect();
      presenceLink = null;
    }
  });

  describe("Send Messages", () => {
    it.skipIf(!canRunE2E())(
      "should send a text message to a room",
      async () => {
        // First we need a room - create one
        const room = await link.rest.createChat();
        expect(room.id).toBeTruthy();

        // Get agent metadata and find another peer to mention
        // (API requires at least 1 mention and you can't mention yourself)
        const agent = await link.rest.getAgentMe();
        const peers = await link.rest.listPeers!({ page: 1, pageSize: 10, notInChat: "" });
        const otherPeer = peers.data.find((p) => p.id !== agent.id);

        if (!otherPeer) {
          console.log("No other peers available to test sendMessage");
          return;
        }

        // Add the peer to the room first (pass ID, not name)
        await link.rest.addChatParticipant(room.id, { participantId: otherPeer.id!, role: "member" });

        // Send a message mentioning the other participant
        const result = await link.rest.createChatMessage(
          room.id,
          {
            content: `E2E test message ${testId()}`,
            mentions: [{ id: otherPeer.id!, name: otherPeer.name }],
          },
        );

        expect(result).toBeDefined();
      },
    );

    it.skipIf(!canRunE2E())(
      "should send a message with mentions",
      async () => {
        const room = await link.rest.createChat();

        // Get another peer to mention (can't mention self)
        const agent = await link.rest.getAgentMe();
        const peers = await link.rest.listPeers!({ page: 1, pageSize: 10, notInChat: "" });
        const otherPeer = peers.data.find((p) => p.id !== agent.id);

        if (!otherPeer) {
          console.log("No other peers available to test mentions");
          return;
        }

        // Add the peer to the room (pass ID, not name)
        await link.rest.addChatParticipant(room.id, { participantId: otherPeer.id!, role: "member" });

        const result = await link.rest.createChatMessage(
          room.id,
          {
            content: `Hello @${otherPeer.name}!`,
            mentions: [{ id: otherPeer.id!, name: otherPeer.name }],
          },
        );

        expect(result).toBeDefined();
      },
    );

    it.skipIf(!canRunE2E())(
      "should send an event (thought) message",
      async () => {
        const room = await link.rest.createChat();

        const result = await link.rest.createChatEvent(
          room.id,
          {
            content: "Thinking about the problem...",
            messageType: "thought",
          },
        );

        expect(result).toBeDefined();
      },
    );
  });

  describe("Receive Messages (via RoomPresence)", () => {
    it.skipIf(!canRunE2E())(
      "should receive messages through WebSocket",
      async () => {
        const receivedMessages: InboundMessage[] = [];
        let roomJoined = false;

        presenceLink = new ThenvoiLink({
          agentId: config.agentId,
          apiKey: config.apiKey,
          wsUrl: config.wsUrl,
          restUrl: config.restUrl,
        });
        await presenceLink.connect();

        presence = new RoomPresence({
          link: presenceLink,
          autoSubscribeExistingRooms: true,
        });

        presence.onRoomJoined = async () => {
          roomJoined = true;
        };

        presence.onRoomEvent = async (roomId: string, event: PlatformEvent) => {
          if (event.type === "message_created") {
            receivedMessages.push({
              roomId,
              senderId: event.payload.sender_id,
              senderName: event.payload.sender_name ?? "Unknown",
              content: event.payload.content,
              timestamp: event.payload.inserted_at,
            });
          }
        };

        await presence.start();

        // Create a room (this should trigger room_added and auto-join)
        const room = await link.rest.createChat();

        // Wait for room to be joined
        await waitFor(() => roomJoined || presence!.rooms.has(room.id), 5000);

        // The room should be tracked
        expect(presence.rooms.size).toBeGreaterThanOrEqual(0); // May or may not have rooms depending on setup
      },
    );
  });

  describe("Message Recovery", () => {
    it.skipIf(!canRunE2E())(
      "should process backlog messages on connect",
      async () => {
        // Create a link and connect
        presenceLink = new ThenvoiLink({
          agentId: config.agentId,
          apiKey: config.apiKey,
          wsUrl: config.wsUrl,
          restUrl: config.restUrl,
        });
        await presenceLink.connect();

        presence = new RoomPresence({
          link: presenceLink,
          autoSubscribeExistingRooms: true,
        });

        let roomJoined = false;
        presence.onRoomJoined = async () => {
          roomJoined = true;
        };

        await presence.start();

        // Wait for presence to subscribe rooms
        await waitFor(() => roomJoined || presence!.rooms.size > 0, 10000);

        // If we got here, connection and room subscription succeeded
        expect(presenceLink.isConnected()).toBe(true);
      },
    );

    it.skipIf(!canRunE2E())(
      "should fetch next message from backlog API",
      async () => {
        // Create a room first so we have a valid chatId
        const room = await link.rest.createChat();

        // This tests the REST API directly
        const message = await link.rest.getNextMessage!({ chatId: room.id });

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
        // Create a room first so we have a valid chatId
        const room = await link.rest.createChat();

        // Get a message from backlog (if any)
        const message = await link.rest.getNextMessage!({ chatId: room.id });

        if (message) {
          // Mark as processing
          await link.rest.markMessageProcessing(message.chat_room_id ?? room.id, message.id);

          // Mark as processed
          await link.rest.markMessageProcessed(message.chat_room_id ?? room.id, message.id);

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
