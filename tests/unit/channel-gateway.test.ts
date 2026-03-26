/**
 * Unit tests for channel gateway lifecycle, deliverMessage, and onRoomEvent.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture RoomPresence instances so we can invoke event handlers in tests
let capturedPresenceInstance: Record<string, unknown>;
let mockLinkInstance: Record<string, unknown>;

vi.mock("@thenvoi/sdk", () => ({
  ThenvoiLink: vi.fn().mockImplementation((opts: Record<string, unknown>) => {
    mockLinkInstance = {
      agentId: opts.agentId,
      rest: {
        getAgentMe: vi.fn().mockResolvedValue({ id: opts.agentId }),
        listChatParticipants: vi.fn().mockResolvedValue([
          { id: "user-789", name: "John Doe", type: "User" },
          { id: opts.agentId, name: "Test Agent", type: "Agent" },
        ]),
        createChatMessage: vi.fn().mockResolvedValue({ ok: true, id: "msg-001" }),
      },
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      markProcessed: vi.fn().mockResolvedValue(undefined),
    };
    return mockLinkInstance;
  }),
}));

vi.mock("@thenvoi/sdk/runtime", () => ({
  RoomPresence: vi.fn().mockImplementation(() => {
    capturedPresenceInstance = {
      onRoomJoined: null,
      onRoomLeft: null,
      onRoomEvent: null,
      onContactEvent: null,
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    return capturedPresenceInstance;
  }),
  ContactEventHandler: vi.fn().mockImplementation(() => ({
    handle: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("@thenvoi/sdk/rest", () => ({}));

import {
  thenvoiChannel,
  deliverMessage,
  setInboundCallback,
  setOpenClawRuntime,
  getLink,
  getAgentId,
  resetGatewayRegistry,
} from "../../src/channel.js";
import { mockAccountConfig } from "../fixtures/configs.js";

// Helper to create a GatewayContext
function createGatewayContext(
  accountId: string,
  account: typeof mockAccountConfig,
  overrides: { aborted?: boolean } = {},
): {
  cfg: unknown;
  accountId: string;
  account: typeof mockAccountConfig;
  abortSignal: AbortSignal;
} {
  const controller = new AbortController();
  if (overrides.aborted) controller.abort();
  return {
    cfg: {},
    accountId,
    account,
    abortSignal: controller.signal,
  };
}

describe("Channel Gateway Lifecycle", () => {
  beforeEach(() => {
    resetGatewayRegistry();
  });

  describe("deliverMessage", () => {
    it("should deliver message when callback is set", () => {
      const callback = vi.fn();
      setInboundCallback(callback);

      const message = {
        channelId: "thenvoi" as const,
        threadId: "room-123",
        senderId: "user-1",
        senderType: "User",
        senderName: "John",
        text: "Hello",
        timestamp: "2025-01-15T10:00:00Z",
      };

      deliverMessage(message);

      expect(callback).toHaveBeenCalledWith(message);
    });

    it("should warn when no callback is set", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const message = {
        channelId: "thenvoi" as const,
        threadId: "room-123",
        senderId: "user-1",
        senderType: "User",
        senderName: "John",
        text: "Hello",
        timestamp: "2025-01-15T10:00:00Z",
      };

      deliverMessage(message);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("no inbound callback set"),
      );
      warnSpy.mockRestore();
    });

    it("should track sender for auto-mention fallback", () => {
      const callback = vi.fn();
      setInboundCallback(callback);

      const message = {
        channelId: "thenvoi" as const,
        threadId: "room-123",
        senderId: "user-1",
        senderType: "User",
        senderName: "John",
        text: "Hello",
        timestamp: "2025-01-15T10:00:00Z",
      };

      deliverMessage(message, "account-1");

      // Verify callback received the message (sender tracking is internal)
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe("startAccount", () => {
    it("should create link, connect, and start presence", async () => {
      const ctx = createGatewayContext("default", mockAccountConfig, { aborted: true });

      await thenvoiChannel.gateway!.startAccount(ctx);

      expect(getLink("default")).toBeDefined();
      expect(getAgentId("default")).toBe("agent-123");
      expect(mockLinkInstance.connect).toHaveBeenCalled();
      expect(capturedPresenceInstance.start).toHaveBeenCalled();
    });

    it("should skip when startAccount is already in progress for same account", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      // Start first call but don't resolve it yet
      const controller1 = new AbortController();
      const ctx1 = {
        cfg: {},
        accountId: "default",
        account: mockAccountConfig,
        abortSignal: controller1.signal,
      };

      const promise1 = thenvoiChannel.gateway!.startAccount(ctx1);

      // Second call should be skipped
      const ctx2 = createGatewayContext("default", mockAccountConfig, { aborted: true });
      await thenvoiChannel.gateway!.startAccount(ctx2);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("already in progress"),
      );

      // Clean up first call
      controller1.abort();
      await promise1;
      warnSpy.mockRestore();
    });

    it("should clean up race guard on error", async () => {
      const badConfig = { ...mockAccountConfig, apiKey: undefined, agentId: undefined };
      // Remove env vars so resolveConfig throws
      delete process.env.THENVOI_API_KEY;
      delete process.env.THENVOI_AGENT_ID;

      const ctx = createGatewayContext("failing-account", badConfig as typeof mockAccountConfig, { aborted: true });

      await expect(thenvoiChannel.gateway!.startAccount(ctx)).rejects.toThrow("THENVOI_API_KEY");

      // The race guard should be cleaned up — a second call should NOT be skipped
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      // This should also fail (same bad config), but it should NOT say "already in progress"
      await expect(
        thenvoiChannel.gateway!.startAccount(ctx),
      ).rejects.toThrow("THENVOI_API_KEY");

      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("already in progress"),
      );
      warnSpy.mockRestore();
    });

    it("should disconnect existing connection before restart", async () => {
      // Start first connection
      const ctx1 = createGatewayContext("default", mockAccountConfig, { aborted: true });
      await thenvoiChannel.gateway!.startAccount(ctx1);

      const firstLink = mockLinkInstance;
      const firstPresence = capturedPresenceInstance;

      // Start second connection for same account
      const ctx2 = createGatewayContext("default", mockAccountConfig, { aborted: true });
      await thenvoiChannel.gateway!.startAccount(ctx2);

      expect(firstPresence.stop).toHaveBeenCalled();
      expect(firstLink.disconnect).toHaveBeenCalled();
    });

    it("should block until abort signal fires", async () => {
      const controller = new AbortController();
      const ctx = {
        cfg: {},
        accountId: "blocking",
        account: mockAccountConfig,
        abortSignal: controller.signal,
      };

      let resolved = false;
      const promise = thenvoiChannel.gateway!.startAccount(ctx).then(() => {
        resolved = true;
      });

      // Give it a tick to reach the await
      await new Promise((r) => setTimeout(r, 10));
      expect(resolved).toBe(false);

      // Signal shutdown
      controller.abort();
      await promise;
      expect(resolved).toBe(true);
    });
  });

  describe("stopAccount", () => {
    it("should disconnect link and stop presence", async () => {
      // First start an account
      const ctx = createGatewayContext("default", mockAccountConfig, { aborted: true });
      await thenvoiChannel.gateway!.startAccount(ctx);

      const stoppedLink = mockLinkInstance;
      const stoppedPresence = capturedPresenceInstance;

      // Reset call counts from startAccount
      vi.mocked(stoppedLink.disconnect as ReturnType<typeof vi.fn>).mockClear();
      vi.mocked(stoppedPresence.stop as ReturnType<typeof vi.fn>).mockClear();

      await thenvoiChannel.gateway!.stopAccount(ctx);

      expect(stoppedPresence.stop).toHaveBeenCalled();
      expect(stoppedLink.disconnect).toHaveBeenCalled();
      expect(getLink("default")).toBeUndefined();
    });

    it("should handle stopping an account that was never started", async () => {
      const ctx = createGatewayContext("never-started", mockAccountConfig, { aborted: true });

      // Should not throw
      await expect(thenvoiChannel.gateway!.stopAccount(ctx)).resolves.toBeUndefined();
    });
  });

  describe("onRoomEvent handler", () => {
    it("should deliver inbound messages via deliverMessage when no runtime", async () => {
      const callback = vi.fn();
      setInboundCallback(callback);

      const ctx = createGatewayContext("default", mockAccountConfig, { aborted: true });
      await thenvoiChannel.gateway!.startAccount(ctx);

      // Invoke the captured onRoomEvent handler
      const onRoomEvent = capturedPresenceInstance.onRoomEvent as (
        roomId: string,
        event: Record<string, unknown>,
      ) => Promise<void>;

      await onRoomEvent("room-123", {
        type: "message_created",
        roomId: "room-123",
        payload: {
          id: "msg-001",
          chat_room_id: "room-123",
          sender_id: "user-789",
          sender_type: "User",
          sender_name: "John Doe",
          content: "Hello there!",
          message_type: "text",
          inserted_at: "2025-01-15T10:00:00Z",
          metadata: {},
        },
      });

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          channelId: "thenvoi",
          threadId: "room-123",
          senderId: "user-789",
          senderName: "John Doe",
          text: "Hello there!",
        }),
      );
    });

    it("should skip messages from the agent itself", async () => {
      const callback = vi.fn();
      setInboundCallback(callback);

      const ctx = createGatewayContext("default", mockAccountConfig, { aborted: true });
      await thenvoiChannel.gateway!.startAccount(ctx);

      const onRoomEvent = capturedPresenceInstance.onRoomEvent as (
        roomId: string,
        event: Record<string, unknown>,
      ) => Promise<void>;

      // Message from the agent itself (agent-123)
      await onRoomEvent("room-123", {
        type: "message_created",
        roomId: "room-123",
        payload: {
          id: "msg-002",
          chat_room_id: "room-123",
          sender_id: "agent-123",
          sender_type: "Agent",
          sender_name: "Test Agent",
          content: "My own message",
          message_type: "text",
          inserted_at: "2025-01-15T10:00:00Z",
          metadata: {},
        },
      });

      expect(callback).not.toHaveBeenCalled();
    });

    it("should skip non-message_created events", async () => {
      const callback = vi.fn();
      setInboundCallback(callback);

      const ctx = createGatewayContext("default", mockAccountConfig, { aborted: true });
      await thenvoiChannel.gateway!.startAccount(ctx);

      const onRoomEvent = capturedPresenceInstance.onRoomEvent as (
        roomId: string,
        event: Record<string, unknown>,
      ) => Promise<void>;

      await onRoomEvent("room-123", {
        type: "participant_joined",
        roomId: "room-123",
        payload: { participant_id: "user-789" },
      });

      expect(callback).not.toHaveBeenCalled();
    });

    it("should skip non-text messages", async () => {
      const callback = vi.fn();
      setInboundCallback(callback);

      const ctx = createGatewayContext("default", mockAccountConfig, { aborted: true });
      await thenvoiChannel.gateway!.startAccount(ctx);

      const onRoomEvent = capturedPresenceInstance.onRoomEvent as (
        roomId: string,
        event: Record<string, unknown>,
      ) => Promise<void>;

      await onRoomEvent("room-123", {
        type: "message_created",
        roomId: "room-123",
        payload: {
          id: "msg-003",
          chat_room_id: "room-123",
          sender_id: "user-789",
          sender_type: "User",
          sender_name: "John Doe",
          content: "Typing...",
          message_type: "thought",
          inserted_at: "2025-01-15T10:00:00Z",
          metadata: {},
        },
      });

      expect(callback).not.toHaveBeenCalled();
    });

    it("should dispatch via OpenClaw runtime when available", async () => {
      const dispatchFn = vi.fn().mockResolvedValue(undefined);
      setOpenClawRuntime({
        channel: {
          reply: {
            dispatchReplyFromConfig: dispatchFn,
          },
        },
        config: {
          loadConfig: () => ({ some: "config" }),
        },
      });

      const ctx = createGatewayContext("default", mockAccountConfig, { aborted: true });
      await thenvoiChannel.gateway!.startAccount(ctx);

      const onRoomEvent = capturedPresenceInstance.onRoomEvent as (
        roomId: string,
        event: Record<string, unknown>,
      ) => Promise<void>;

      await onRoomEvent("room-123", {
        type: "message_created",
        roomId: "room-123",
        payload: {
          id: "msg-001",
          chat_room_id: "room-123",
          sender_id: "user-789",
          sender_type: "User",
          sender_name: "John Doe",
          content: "Hello!",
          message_type: "text",
          inserted_at: "2025-01-15T10:00:00Z",
          metadata: {},
        },
      });

      expect(dispatchFn).toHaveBeenCalledWith(
        expect.objectContaining({
          ctx: expect.objectContaining({
            Body: "Hello!",
            From: "user-789",
            SenderName: "John Doe",
            To: "room-123",
          }),
          cfg: { some: "config" },
          dispatcher: expect.objectContaining({
            sendToolResult: expect.any(Function),
            sendBlockReply: expect.any(Function),
            sendFinalReply: expect.any(Function),
            waitForIdle: expect.any(Function),
          }),
        }),
      );
    });

    it("should mark message as processed after handling", async () => {
      const callback = vi.fn();
      setInboundCallback(callback);

      const ctx = createGatewayContext("default", mockAccountConfig, { aborted: true });
      await thenvoiChannel.gateway!.startAccount(ctx);

      const onRoomEvent = capturedPresenceInstance.onRoomEvent as (
        roomId: string,
        event: Record<string, unknown>,
      ) => Promise<void>;

      await onRoomEvent("room-123", {
        type: "message_created",
        roomId: "room-123",
        payload: {
          id: "msg-001",
          chat_room_id: "room-123",
          sender_id: "user-789",
          sender_type: "User",
          sender_name: "John Doe",
          content: "Hello!",
          message_type: "text",
          inserted_at: "2025-01-15T10:00:00Z",
          metadata: {},
        },
      });

      expect(mockLinkInstance.markProcessed).toHaveBeenCalledWith(
        "room-123",
        "msg-001",
        { bestEffort: true },
      );
    });
  });
});
