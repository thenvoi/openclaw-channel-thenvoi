/**
 * Integration test: verifies the full message flow through the SDK layer.
 *
 * Wires startAccount → receive event → dispatch → reply delivery,
 * with mocked SDK classes but real channel.ts logic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture RoomPresence instance so we can drive events
let capturedPresence: Record<string, unknown>;
let mockLinkInstance: Record<string, unknown>;

vi.mock("@thenvoi/sdk", () => {
  const ThenvoiLink = vi.fn(function (this: Record<string, unknown>, opts: Record<string, unknown>) {
    mockLinkInstance = {
      agentId: opts.agentId,
      rest: {
        getAgentMe: vi.fn().mockResolvedValue({ id: opts.agentId }),
        listChatParticipants: vi.fn().mockResolvedValue([
          { id: "user-789", name: "John Doe", type: "User" },
          { id: opts.agentId, name: "Test Agent", type: "Agent" },
        ]),
        createChatMessage: vi.fn().mockResolvedValue({ ok: true, id: "msg-reply-001" }),
      },
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      markProcessing: vi.fn().mockResolvedValue(undefined),
      markProcessed: vi.fn().mockResolvedValue(undefined),
    };
    Object.assign(this, mockLinkInstance);
    return mockLinkInstance;
  });
  return { ThenvoiLink };
});

vi.mock("@thenvoi/sdk/runtime", () => {
  const RoomPresence = vi.fn(function (this: Record<string, unknown>) {
    capturedPresence = {
      onRoomJoined: null,
      onRoomLeft: null,
      onRoomEvent: null,
      onContactEvent: null,
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    Object.assign(this, capturedPresence);
    return capturedPresence;
  });
  const ContactEventHandler = vi.fn(function (this: Record<string, unknown>) {
    const instance = { handle: vi.fn().mockResolvedValue(undefined) };
    Object.assign(this, instance);
    return instance;
  });
  return { RoomPresence, ContactEventHandler };
});

vi.mock("@thenvoi/sdk/rest", () => ({}));

import {
  thenvoiChannel,
  setOpenClawRuntime,
  resetGatewayRegistry,
} from "../../src/channel.js";

const mockAccountConfig = {
  enabled: true,
  apiKey: "test-api-key",
  agentId: "agent-123",
  wsUrl: "wss://test.thenvoi.com/socket",
  restUrl: "https://test.thenvoi.com",
};

describe("SDK Message Flow Integration", () => {
  beforeEach(() => {
    resetGatewayRegistry();
  });

  it("should flow: startAccount → receive event → dispatch → send reply → mark processed", async () => {
    // 1. Set up the OpenClaw runtime with a dispatch function that sends a reply
    const dispatchFn = vi.fn().mockImplementation(async (args: Record<string, unknown>) => {
      const dispatcher = args.dispatcher as {
        sendFinalReply: (payload: unknown) => boolean;
        waitForIdle: () => Promise<void>;
      };
      // Simulate the agent sending a reply
      dispatcher.sendFinalReply({ text: "Hello back!" });
    });

    setOpenClawRuntime({
      channel: {
        reply: { dispatchReplyFromConfig: dispatchFn },
      },
      config: {
        loadConfig: () => ({ some: "config" }),
      },
    });

    // 2. Start the account (pre-abort so it doesn't block)
    const controller = new AbortController();
    controller.abort();
    const ctx = {
      cfg: {},
      accountId: "default",
      account: mockAccountConfig,
      abortSignal: controller.signal,
    };
    await thenvoiChannel.gateway!.startAccount(ctx);

    // 3. Simulate an inbound message via onRoomEvent
    const onRoomEvent = capturedPresence.onRoomEvent as (
      roomId: string,
      event: Record<string, unknown>,
    ) => Promise<void>;

    await onRoomEvent("room-100", {
      type: "message_created",
      roomId: "room-100",
      payload: {
        id: "msg-inbound-001",
        chat_room_id: "room-100",
        sender_id: "user-789",
        sender_type: "User",
        sender_name: "John Doe",
        content: "Hello agent!",
        message_type: "text",
        inserted_at: "2025-06-01T12:00:00Z",
        metadata: {},
      },
    });

    // 4. Verify the full flow
    // 4a. Dispatch was called with the right context
    expect(dispatchFn).toHaveBeenCalledWith(
      expect.objectContaining({
        ctx: expect.objectContaining({
          Body: "Hello agent!",
          From: "user-789",
          SenderName: "John Doe",
          To: "room-100",
          Surface: "thenvoi",
        }),
        cfg: { some: "config" },
      }),
    );

    // 4b. Reply was sent to Thenvoi via REST
    const rest = mockLinkInstance.rest as Record<string, ReturnType<typeof vi.fn>>;
    expect(rest.createChatMessage).toHaveBeenCalledWith(
      "room-100",
      expect.objectContaining({
        content: "Hello back!",
        mentions: expect.arrayContaining([
          expect.objectContaining({ id: "user-789" }),
        ]),
      }),
    );

    // 4c. Message was marked as processing then processed
    expect(mockLinkInstance.markProcessing).toHaveBeenCalledWith(
      "room-100",
      "msg-inbound-001",
    );
    expect(mockLinkInstance.markProcessed).toHaveBeenCalledWith(
      "room-100",
      "msg-inbound-001",
    );
  });

  it("should fall back to deliverMessage when no runtime is set", async () => {
    const { setInboundCallback } = await import("../../src/channel.js");
    const inboundCallback = vi.fn();
    setInboundCallback(inboundCallback);

    // Start without setting runtime
    const controller = new AbortController();
    controller.abort();
    const ctx = {
      cfg: {},
      accountId: "default",
      account: mockAccountConfig,
      abortSignal: controller.signal,
    };
    await thenvoiChannel.gateway!.startAccount(ctx);

    const onRoomEvent = capturedPresence.onRoomEvent as (
      roomId: string,
      event: Record<string, unknown>,
    ) => Promise<void>;

    await onRoomEvent("room-200", {
      type: "message_created",
      roomId: "room-200",
      payload: {
        id: "msg-002",
        chat_room_id: "room-200",
        sender_id: "user-789",
        sender_type: "User",
        sender_name: "John Doe",
        content: "Hello without runtime!",
        message_type: "text",
        inserted_at: "2025-06-01T12:00:00Z",
        metadata: {},
      },
    });

    // Message delivered via callback
    expect(inboundCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: "thenvoi",
        threadId: "room-200",
        text: "Hello without runtime!",
        senderId: "user-789",
        senderName: "John Doe",
      }),
    );

    // Still marked as processing then processed
    expect(mockLinkInstance.markProcessing).toHaveBeenCalledWith(
      "room-200",
      "msg-002",
    );
    expect(mockLinkInstance.markProcessed).toHaveBeenCalledWith(
      "room-200",
      "msg-002",
    );
  });
});
