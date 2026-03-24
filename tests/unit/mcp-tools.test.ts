/**
 * Unit tests for MCP tools.
 * Mocks getLink() to return a mock ThenvoiLink with a mock rest API.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  mcpTools,
  getMcpTool,
  executeMcpTool,
  getMcpToolSchemas,
} from "../../src/mcp-tools.js";
import * as channel from "../../src/channel.js";
import {
  mockLookupPeersResponse,
  mockAddParticipantResponse,
  mockCreateChatroomResponse,
  mockParticipants,
  mockSendMessageResponse,
} from "../fixtures/payloads.js";

// Mock the channel module
vi.mock("../../src/channel.js", () => ({
  getLink: vi.fn(),
  getAgentId: vi.fn(),
}));

describe("MCP Tools", () => {
  // Mock REST API methods matching SDK's RestApi interface
  const mockRest = {
    getAgentMe: vi.fn(),
    listPeers: vi.fn(),
    addChatParticipant: vi.fn(),
    removeChatParticipant: vi.fn(),
    listChatParticipants: vi.fn(),
    createChat: vi.fn(),
    createChatMessage: vi.fn(),
    createChatEvent: vi.fn(),
    listContacts: vi.fn(),
    addContact: vi.fn(),
    removeContact: vi.fn(),
    listContactRequests: vi.fn(),
    respondContactRequest: vi.fn(),
    markMessageProcessing: vi.fn(),
    markMessageProcessed: vi.fn(),
    markMessageFailed: vi.fn(),
  };

  // Mock ThenvoiLink object with rest property
  const mockLink = {
    rest: mockRest,
    agentId: "agent-123",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(channel.getLink).mockReturnValue(mockLink as unknown as ReturnType<typeof channel.getLink>);
    vi.mocked(channel.getAgentId).mockReturnValue("agent-123");
  });

  describe("mcpTools array", () => {
    it("should contain 12 tools", () => {
      expect(mcpTools).toHaveLength(12);
    });

    it("should have unique tool names", () => {
      const names = mcpTools.map((t) => t.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });

    it("should have valid input schemas", () => {
      mcpTools.forEach((tool) => {
        expect(tool.inputSchema.type).toBe("object");
        expect(typeof tool.inputSchema.properties).toBe("object");
      });
    });

    it("should have descriptions for all tools", () => {
      mcpTools.forEach((tool) => {
        expect(tool.description.length).toBeGreaterThan(10);
      });
    });
  });

  describe("getMcpTool", () => {
    it("should return tool by name", () => {
      const tool = getMcpTool("thenvoi_lookup_peers");
      expect(tool).toBeDefined();
      expect(tool?.name).toBe("thenvoi_lookup_peers");
    });

    it("should return undefined for unknown tool", () => {
      const tool = getMcpTool("unknown_tool");
      expect(tool).toBeUndefined();
    });
  });

  describe("getMcpToolSchemas", () => {
    it("should return schemas without handlers", () => {
      const schemas = getMcpToolSchemas();

      expect(schemas).toHaveLength(12);
      schemas.forEach((schema) => {
        expect(schema).toHaveProperty("name");
        expect(schema).toHaveProperty("description");
        expect(schema).toHaveProperty("inputSchema");
        expect(schema).not.toHaveProperty("handler");
      });
    });
  });

  describe("executeMcpTool", () => {
    it("should throw for unknown tool", async () => {
      await expect(executeMcpTool("unknown", {})).rejects.toThrow(
        "Unknown tool: unknown",
      );
    });
  });

  describe("thenvoi_lookup_peers", () => {
    it("should call listPeers with default pagination", async () => {
      mockRest.listPeers.mockResolvedValue(mockLookupPeersResponse);

      const result = await executeMcpTool("thenvoi_lookup_peers", {});

      expect(mockRest.listPeers).toHaveBeenCalledWith({ page: 1, pageSize: 50, notInChat: "" });
      expect(result).toHaveProperty("peers");
      expect(result).toHaveProperty("total");
      expect(result).toHaveProperty("has_more");
    });

    it("should call listPeers with provided pagination", async () => {
      mockRest.listPeers.mockResolvedValue(mockLookupPeersResponse);

      await executeMcpTool("thenvoi_lookup_peers", { page: 2, page_size: 25 });

      expect(mockRest.listPeers).toHaveBeenCalledWith({ page: 2, pageSize: 25, notInChat: "" });
    });

    it("should throw when link not connected", async () => {
      vi.mocked(channel.getLink).mockReturnValue(undefined);

      await expect(executeMcpTool("thenvoi_lookup_peers", {})).rejects.toThrow(
        "Thenvoi client not connected",
      );
    });
  });

  describe("thenvoi_add_participant", () => {
    it("should lookup peer and call addChatParticipant with UUID", async () => {
      mockRest.listPeers.mockResolvedValue(mockLookupPeersResponse);
      mockRest.addChatParticipant.mockResolvedValue(mockAddParticipantResponse);

      const result = await executeMcpTool("thenvoi_add_participant", {
        room_id: "room-001",
        handle: "Weather Agent",
      });

      expect(mockRest.listPeers).toHaveBeenCalled();
      expect(mockRest.addChatParticipant).toHaveBeenCalledWith(
        "room-001",
        { participantId: "agent-weather", role: "member" },
      );
      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("participant");
    });

    it("should call addChatParticipant with provided role", async () => {
      const peersWithAdmin = {
        ...mockLookupPeersResponse,
        data: [
          ...mockLookupPeersResponse.data,
          { id: "user-admin", name: "Admin User", type: "User", handle: "@admin" },
        ],
      };
      mockRest.listPeers.mockResolvedValue(peersWithAdmin);
      mockRest.addChatParticipant.mockResolvedValue(mockAddParticipantResponse);

      await executeMcpTool("thenvoi_add_participant", {
        room_id: "room-001",
        handle: "Admin User",
        role: "admin",
      });

      expect(mockRest.addChatParticipant).toHaveBeenCalledWith(
        "room-001",
        { participantId: "user-admin", role: "admin" },
      );
    });

    it("should throw when peer not found", async () => {
      mockRest.listPeers.mockResolvedValue(mockLookupPeersResponse);

      await expect(
        executeMcpTool("thenvoi_add_participant", {
          room_id: "room-001",
          handle: "Unknown User",
        }),
      ).rejects.toThrow('Peer not found: "Unknown User"');
    });

    it("should throw when link not connected", async () => {
      vi.mocked(channel.getLink).mockReturnValue(undefined);

      await expect(
        executeMcpTool("thenvoi_add_participant", {
          room_id: "room-001",
          handle: "Test",
        }),
      ).rejects.toThrow("Thenvoi client not connected");
    });
  });

  describe("thenvoi_remove_participant", () => {
    it("should call removeChatParticipant", async () => {
      mockRest.removeChatParticipant.mockResolvedValue({ ok: true });

      const result = await executeMcpTool("thenvoi_remove_participant", {
        room_id: "room-001",
        name: "Weather Agent",
      });

      expect(mockRest.removeChatParticipant).toHaveBeenCalledWith(
        "room-001",
        "Weather Agent",
      );
      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("message");
    });
  });

  describe("thenvoi_get_participants", () => {
    it("should return participants list", async () => {
      mockRest.listChatParticipants.mockResolvedValue(mockParticipants);

      const result = (await executeMcpTool("thenvoi_get_participants", {
        room_id: "room-001",
      })) as { participants: unknown[]; count: number };

      expect(mockRest.listChatParticipants).toHaveBeenCalledWith("room-001");
      expect(result).toHaveProperty("participants");
      expect(result).toHaveProperty("count", mockParticipants.length);
    });
  });

  describe("thenvoi_create_chatroom", () => {
    it("should create room without task_id", async () => {
      mockRest.createChat.mockResolvedValue(mockCreateChatroomResponse);

      const result = await executeMcpTool("thenvoi_create_chatroom", {});

      expect(mockRest.createChat).toHaveBeenCalledWith(undefined);
      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("room_id");
    });

    it("should create room with task_id", async () => {
      mockRest.createChat.mockResolvedValue(mockCreateChatroomResponse);

      await executeMcpTool("thenvoi_create_chatroom", { task_id: "task-123" });

      expect(mockRest.createChat).toHaveBeenCalledWith("task-123");
    });
  });

  describe("thenvoi_send_event", () => {
    const mockEventResponse = {
      ok: true,
      id: "event-001",
    };

    it("should send thought event", async () => {
      mockRest.createChatEvent.mockResolvedValue(mockEventResponse);

      const result = await executeMcpTool("thenvoi_send_event", {
        room_id: "room-001",
        content: "Thinking about this...",
        message_type: "thought",
      });

      expect(mockRest.createChatEvent).toHaveBeenCalledWith(
        "room-001",
        {
          content: "Thinking about this...",
          messageType: "thought",
          metadata: undefined,
        },
      );
      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("event_id", "event-001");
      expect(result).toHaveProperty("message_type", "thought");
    });

    it("should send tool_call event with metadata", async () => {
      mockRest.createChatEvent.mockResolvedValue(mockEventResponse);

      const metadata = {
        tool_call_id: "call-123",
        name: "search",
        args: { query: "test query" },
      };

      const result = await executeMcpTool("thenvoi_send_event", {
        room_id: "room-001",
        content: "Calling search tool...",
        message_type: "tool_call",
        metadata,
      });

      expect(mockRest.createChatEvent).toHaveBeenCalledWith(
        "room-001",
        {
          content: "Calling search tool...",
          messageType: "tool_call",
          metadata,
        },
      );
      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("message_type", "tool_call");
    });
  });

  describe("thenvoi_send_message", () => {
    it("should send message with mentions", async () => {
      mockRest.listChatParticipants.mockResolvedValue(mockParticipants);
      mockRest.createChatMessage.mockResolvedValue(mockSendMessageResponse);

      const result = await executeMcpTool("thenvoi_send_message", {
        room_id: "room-001",
        content: "Hello!",
        mentions: ["John Doe"],
      });

      expect(mockRest.listChatParticipants).toHaveBeenCalledWith("room-001");
      expect(mockRest.createChatMessage).toHaveBeenCalledWith(
        "room-001",
        {
          content: "Hello!",
          mentions: [{ id: "user-789", name: "John Doe" }],
        },
      );
      expect(result).toHaveProperty("success", true);
    });

    it("should throw error if mention not found", async () => {
      mockRest.listChatParticipants.mockResolvedValue(mockParticipants);

      await expect(
        executeMcpTool("thenvoi_send_message", {
          room_id: "room-001",
          content: "Hello!",
          mentions: ["Unknown Person"],
        }),
      ).rejects.toThrow('Participant "Unknown Person" not found in room');
    });

    it("should throw error if no mentions provided", async () => {
      await expect(
        executeMcpTool("thenvoi_send_message", {
          room_id: "room-001",
          content: "Hello!",
          mentions: [],
        }),
      ).rejects.toThrow("At least one mention is required");
    });
  });
});
