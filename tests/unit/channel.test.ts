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
        senderType: "User",
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
