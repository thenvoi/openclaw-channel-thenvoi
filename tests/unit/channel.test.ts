/**
 * Unit tests for channel module.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the SDK modules before importing channel.ts
// This prevents vitest from loading the SDK's optional peer dependencies
vi.mock("@thenvoi/sdk", () => ({
  ThenvoiLink: vi.fn().mockImplementation((opts: Record<string, unknown>) => ({
    agentId: opts.agentId,
    rest: {
      // Use real fetch so validateConfig tests work with mock fetch
      getAgentMe: vi.fn().mockImplementation(async () => {
        const restUrl = (opts.restUrl as string || "").replace(/\/$/, "");
        const response = await fetch(`${restUrl}/api/v1/agent/me`, {
          headers: { "X-API-Key": opts.apiKey as string },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      }),
      listChatParticipants: vi.fn(),
      createChatMessage: vi.fn(),
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
  })),
}));

vi.mock("@thenvoi/sdk/runtime", () => ({
  RoomPresence: vi.fn().mockImplementation(() => ({
    onRoomJoined: null,
    onRoomLeft: null,
    onRoomEvent: null,
    onContactEvent: null,
    start: vi.fn(),
    stop: vi.fn(),
  })),
  ContactEventHandler: vi.fn().mockImplementation(() => ({
    handle: vi.fn(),
  })),
}));

vi.mock("@thenvoi/sdk/rest", () => ({}));

import {
  thenvoiChannel,
  registerChannel,
  setInboundCallback,
  getLink,
  getAgentId,
  _testing,
} from "../../src/channel.js";
import {
  mockAccountConfig,
  mockPluginConfig,
  mockEmptyPluginConfig,
} from "../fixtures/configs.js";
import { createMockFetch } from "../__mocks__/fetch.js";
import { mockAgentMetadata } from "../fixtures/payloads.js";

describe("Channel Module", () => {
  let fetchMock: ReturnType<typeof createMockFetch>;

  beforeEach(() => {
    fetchMock = createMockFetch({ response: {} });
    globalThis.fetch = fetchMock;
  });

  describe("thenvoiChannel.meta", () => {
    it("should have correct metadata", () => {
      expect(thenvoiChannel.id).toBe("openclaw-channel-thenvoi");
      expect(thenvoiChannel.meta.id).toBe("openclaw-channel-thenvoi");
      expect(thenvoiChannel.meta.label).toBe("Thenvoi");
      expect(thenvoiChannel.meta.aliases).toContain("thenvoi");
    });

    it("should have documentation path", () => {
      expect(thenvoiChannel.meta.docsPath).toBe("/channels/thenvoi");
    });

    it("should have selection label", () => {
      expect(thenvoiChannel.meta.selectionLabel).toContain("Thenvoi");
    });
  });

  describe("thenvoiChannel.capabilities", () => {
    it("should support direct and group chats", () => {
      expect(thenvoiChannel.capabilities.chatTypes).toContain("direct");
      expect(thenvoiChannel.capabilities.chatTypes).toContain("group");
    });

    it("should support threading and mentions", () => {
      expect(thenvoiChannel.capabilities.features).toContain("threading");
      expect(thenvoiChannel.capabilities.features).toContain("mentions");
    });
  });

  describe("thenvoiChannel.config", () => {
    describe("listAccountIds", () => {
      it("should return account IDs from config", () => {
        const ids = thenvoiChannel.config.listAccountIds(mockPluginConfig);

        expect(ids).toContain("default");
        expect(ids).toContain("secondary");
      });

      it("should return empty array when no accounts", () => {
        const ids = thenvoiChannel.config.listAccountIds(mockEmptyPluginConfig);

        expect(ids).toEqual([]);
      });
    });

    describe("resolveAccount", () => {
      it("should return account config by ID", () => {
        const account = thenvoiChannel.config.resolveAccount(
          mockPluginConfig,
          "default",
        );

        expect(account).toBeDefined();
        expect(account.apiKey).toBe("test-api-key-12345");
      });

      it("should return default account when ID not specified", () => {
        const account = thenvoiChannel.config.resolveAccount(mockPluginConfig);

        expect(account.apiKey).toBe("test-api-key-12345");
      });

      it("should return enabled: true for missing account", () => {
        const account = thenvoiChannel.config.resolveAccount(
          mockEmptyPluginConfig,
          "unknown",
        );

        expect(account.enabled).toBe(true);
      });
    });
  });

  describe("thenvoiChannel.outbound", () => {
    it("should have direct delivery mode", () => {
      expect(thenvoiChannel.outbound.deliveryMode).toBe("direct");
    });

    describe("sendText", () => {
      it("should fail when target (to) not provided", async () => {
        await expect(
          thenvoiChannel.outbound.sendText({
            cfg: {},
            to: "",
            text: "Hello",
          })
        ).rejects.toThrow("room_id is required");
      });

      it("should fail when link not initialized", async () => {
        await expect(
          thenvoiChannel.outbound.sendText({
            cfg: {},
            to: "room-001",
            text: "Hello",
          })
        ).rejects.toThrow("not initialized");
      });
    });
  });

  describe("thenvoiChannel.setup", () => {
    describe("validateConfig", () => {
      it("should validate correct config", async () => {
        fetchMock = createMockFetch({ response: mockAgentMetadata });
        globalThis.fetch = fetchMock;

        const result =
          await thenvoiChannel.setup!.validateConfig!(mockAccountConfig);

        expect(result.valid).toBe(true);
        expect(result.errors).toBeUndefined();
      });

      it("should fail for missing API key", async () => {
        const result = await thenvoiChannel.setup!.validateConfig!({});

        expect(result.valid).toBe(false);
        expect(result.errors?.[0]).toContain("THENVOI_API_KEY");
      });

      it("should fail when API returns error", async () => {
        fetchMock = createMockFetch({
          status: 401,
          ok: false,
          textResponse: "Unauthorized",
        });
        globalThis.fetch = fetchMock;

        const result =
          await thenvoiChannel.setup!.validateConfig!(mockAccountConfig);

        expect(result.valid).toBe(false);
      });
    });
  });

  describe("thenvoiChannel.threading", () => {
    it("should extract threadId from message", () => {
      const message = {
        channelId: "thenvoi" as const,
        threadId: "room-123",
        senderId: "user-1",
        senderType: "User" as const,
        senderName: "John",
        text: "Hello",
        timestamp: "2025-01-15T10:00:00Z",
      };

      const threadId = thenvoiChannel.threading!.extractThreadId(message);

      expect(threadId).toBe("room-123");
    });

    it("should format thread context", () => {
      const context = thenvoiChannel.threading!.formatThreadContext!("room-123");

      expect(context).toContain("room-123");
      expect(context).toContain("Thenvoi");
    });
  });

  describe("registerChannel", () => {
    it("should call api.registerChannel", () => {
      const mockApi = {
        registerChannel: vi.fn(),
      };

      registerChannel(mockApi);

      expect(mockApi.registerChannel).toHaveBeenCalledWith({
        plugin: thenvoiChannel,
      });
    });
  });

  describe("setInboundCallback", () => {
    it("should set the callback", () => {
      const callback = vi.fn();

      // Should not throw
      expect(() => setInboundCallback(callback)).not.toThrow();
    });
  });

  describe("getLink / getAgentId", () => {
    it("should return undefined when not started", () => {
      expect(getLink("nonexistent")).toBeUndefined();
      expect(getAgentId("nonexistent")).toBeUndefined();
    });

    it("should use default account ID", () => {
      expect(getLink()).toBeUndefined();
      expect(getAgentId()).toBeUndefined();
    });
  });
});

// =============================================================================
// Internal function tests (via _testing export)
// =============================================================================

describe("platformEventToInboundMessage", () => {
  const { platformEventToInboundMessage } = _testing;

  const validEvent = {
    type: "message_created" as const,
    roomId: "room-abc",
    payload: {
      id: "msg-1",
      chat_room_id: "room-abc",
      sender_id: "user-1",
      sender_type: "User",
      sender_name: "Alice",
      content: "Hello world",
      message_type: "text",
      inserted_at: "2025-03-26T10:00:00Z",
      metadata: { mentions: [{ id: "agent-1", name: "Bot" }] },
    },
  };

  it("should convert a valid message_created event", () => {
    const result = platformEventToInboundMessage(validEvent as never);

    expect(result).toEqual({
      channelId: "thenvoi",
      threadId: "room-abc",
      senderId: "user-1",
      senderType: "User",
      senderName: "Alice",
      text: "Hello world",
      timestamp: "2025-03-26T10:00:00Z",
      metadata: {
        messageId: "msg-1",
        messageType: "text",
        mentions: [{ id: "agent-1", name: "Bot" }],
      },
    });
  });

  it("should return null for non-message_created events", () => {
    const event = { ...validEvent, type: "participant_added" as never };
    expect(platformEventToInboundMessage(event as never)).toBeNull();
  });

  it("should return null for non-text message types", () => {
    const event = {
      ...validEvent,
      payload: { ...validEvent.payload, message_type: "thought" },
    };
    expect(platformEventToInboundMessage(event as never)).toBeNull();
  });

  it("should return null when no roomId available", () => {
    const event = {
      ...validEvent,
      roomId: undefined,
      payload: { ...validEvent.payload, chat_room_id: undefined },
    };
    expect(platformEventToInboundMessage(event as never)).toBeNull();
  });

  it("should fall back to payload.chat_room_id when event.roomId is missing", () => {
    const event = {
      ...validEvent,
      roomId: undefined,
      payload: { ...validEvent.payload, chat_room_id: "room-from-payload" },
    };
    const result = platformEventToInboundMessage(event as never);
    expect(result?.threadId).toBe("room-from-payload");
  });

  it("should default senderName to Unknown when missing", () => {
    const event = {
      ...validEvent,
      payload: { ...validEvent.payload, sender_name: undefined },
    };
    const result = platformEventToInboundMessage(event as never);
    expect(result?.senderName).toBe("Unknown");
  });
});

describe("resolveMentions", () => {
  const { resolveMentions, trackSender, clearParticipantCache, clearSenderCache } = _testing;

  const mockParticipants = [
    { id: "user-1", name: "Alice", type: "User" },
    { id: "user-2", name: "Bob", type: "User" },
    { id: "agent-self", name: "MyBot", type: "Agent" },
  ];

  let mockRest: { listChatParticipants: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    clearParticipantCache();
    clearSenderCache();
    mockRest = {
      listChatParticipants: vi.fn().mockResolvedValue(mockParticipants),
    };
  });

  it("should resolve explicit @Name mentions in text", async () => {
    const result = await resolveMentions(mockRest as never, "agent-self", "room-1", "Hey @Alice check this");

    expect(result).not.toBeNull();
    expect(result!.mentions).toEqual([{ id: "user-1", name: "Alice" }]);
  });

  it("should resolve multiple @Name mentions", async () => {
    const result = await resolveMentions(mockRest as never, "agent-self", "room-1", "@Alice and @Bob please review");

    expect(result!.mentions).toHaveLength(2);
    expect(result!.mentions).toContainEqual({ id: "user-1", name: "Alice" });
    expect(result!.mentions).toContainEqual({ id: "user-2", name: "Bob" });
  });

  it("should skip self agent in @Name matches", async () => {
    const result = await resolveMentions(mockRest as never, "agent-self", "room-1", "Hey @MyBot what about @Alice");

    expect(result!.mentions).toEqual([{ id: "user-1", name: "Alice" }]);
  });

  it("should fall back to last sender when no @mentions", async () => {
    trackSender("room-1", "user-2", "Bob");

    const result = await resolveMentions(mockRest as never, "agent-self", "room-1", "Sure, sounds good");

    expect(result!.mentions).toEqual([{ id: "user-2", name: "Bob" }]);
  });

  it("should fall back to first other participant when no @mentions and no last sender", async () => {
    const result = await resolveMentions(mockRest as never, "agent-self", "room-1", "Hello everyone");

    expect(result!.mentions).toEqual([{ id: "user-1", name: "Alice" }]);
  });

  it("should return null when no other participants exist", async () => {
    mockRest.listChatParticipants.mockResolvedValue([
      { id: "agent-self", name: "MyBot", type: "Agent" },
    ]);

    const result = await resolveMentions(mockRest as never, "agent-self", "room-1", "Hello?");

    expect(result).toBeNull();
  });

  it("should use cached participants on subsequent calls within TTL", async () => {
    await resolveMentions(mockRest as never, "agent-self", "room-1", "first call");
    await resolveMentions(mockRest as never, "agent-self", "room-1", "second call");

    expect(mockRest.listChatParticipants).toHaveBeenCalledTimes(1);
  });
});

describe("trackSender", () => {
  const { trackSender, clearSenderCache, getSenderCacheSize, MAX_SENDER_CACHE, resolveMentions, clearParticipantCache } = _testing;

  beforeEach(() => {
    clearSenderCache();
    clearParticipantCache();
  });

  it("should track sender and use it in resolveMentions fallback", async () => {
    const mockRest = {
      listChatParticipants: vi.fn().mockResolvedValue([
        { id: "user-1", name: "Alice", type: "User" },
        { id: "agent-self", name: "Bot", type: "Agent" },
      ]),
    };

    trackSender("room-1", "user-1", "Alice");
    const result = await resolveMentions(mockRest as never, "agent-self", "room-1", "reply text");

    expect(result!.mentions).toEqual([{ id: "user-1", name: "Alice" }]);
  });

  it("should evict oldest entry when cache exceeds MAX_SENDER_CACHE", () => {
    // Fill the cache
    for (let i = 0; i < MAX_SENDER_CACHE; i++) {
      trackSender(`room-${i}`, `user-${i}`, `User ${i}`);
    }
    expect(getSenderCacheSize()).toBe(MAX_SENDER_CACHE);

    // Add one more — should evict the first
    trackSender("room-new", "user-new", "New User");
    expect(getSenderCacheSize()).toBe(MAX_SENDER_CACHE);
  });

  it("should update existing entry for same room", () => {
    trackSender("room-1", "user-1", "Alice");
    trackSender("room-1", "user-2", "Bob");

    // Size should not increase — same key
    expect(getSenderCacheSize()).toBe(1);
  });
});
