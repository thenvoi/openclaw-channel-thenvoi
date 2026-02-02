/**
 * Unit tests for MCP tools.
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
  getClient: vi.fn(),
}));

describe("MCP Tools", () => {
  const mockClient = {
    lookupPeers: vi.fn(),
    addParticipant: vi.fn(),
    removeParticipant: vi.fn(),
    getParticipants: vi.fn(),
    createChatroom: vi.fn(),
    sendMessage: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(channel.getClient).mockReturnValue(mockClient as unknown as ReturnType<typeof channel.getClient>);
  });

  describe("mcpTools array", () => {
    it("should contain 6 tools", () => {
      expect(mcpTools).toHaveLength(6);
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

      expect(schemas).toHaveLength(6);
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
    it("should call lookupPeers with default pagination", async () => {
      mockClient.lookupPeers.mockResolvedValue(mockLookupPeersResponse);

      const result = await executeMcpTool("thenvoi_lookup_peers", {});

      expect(mockClient.lookupPeers).toHaveBeenCalledWith(1, 50);
      expect(result).toHaveProperty("peers");
      expect(result).toHaveProperty("total");
      expect(result).toHaveProperty("has_more");
    });

    it("should call lookupPeers with provided pagination", async () => {
      mockClient.lookupPeers.mockResolvedValue(mockLookupPeersResponse);

      await executeMcpTool("thenvoi_lookup_peers", { page: 2, page_size: 25 });

      expect(mockClient.lookupPeers).toHaveBeenCalledWith(2, 25);
    });

    it("should throw when client not connected", async () => {
      vi.mocked(channel.getClient).mockReturnValue(undefined);

      await expect(executeMcpTool("thenvoi_lookup_peers", {})).rejects.toThrow(
        "Thenvoi client not connected",
      );
    });
  });

  describe("thenvoi_add_participant", () => {
    it("should call addParticipant with default role", async () => {
      mockClient.addParticipant.mockResolvedValue(mockAddParticipantResponse);

      const result = await executeMcpTool("thenvoi_add_participant", {
        room_id: "room-001",
        name: "Weather Agent",
      });

      expect(mockClient.addParticipant).toHaveBeenCalledWith(
        "room-001",
        "Weather Agent",
        "member",
      );
      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("participant");
    });

    it("should call addParticipant with provided role", async () => {
      mockClient.addParticipant.mockResolvedValue(mockAddParticipantResponse);

      await executeMcpTool("thenvoi_add_participant", {
        room_id: "room-001",
        name: "Admin User",
        role: "admin",
      });

      expect(mockClient.addParticipant).toHaveBeenCalledWith(
        "room-001",
        "Admin User",
        "admin",
      );
    });

    it("should throw when client not connected", async () => {
      vi.mocked(channel.getClient).mockReturnValue(undefined);

      await expect(
        executeMcpTool("thenvoi_add_participant", {
          room_id: "room-001",
          name: "Test",
        }),
      ).rejects.toThrow("Thenvoi client not connected");
    });
  });

  describe("thenvoi_remove_participant", () => {
    it("should call removeParticipant", async () => {
      mockClient.removeParticipant.mockResolvedValue(undefined);

      const result = await executeMcpTool("thenvoi_remove_participant", {
        room_id: "room-001",
        name: "Weather Agent",
      });

      expect(mockClient.removeParticipant).toHaveBeenCalledWith(
        "room-001",
        "Weather Agent",
      );
      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("message");
    });
  });

  describe("thenvoi_get_participants", () => {
    it("should return participants list", async () => {
      mockClient.getParticipants.mockResolvedValue(mockParticipants);

      const result = (await executeMcpTool("thenvoi_get_participants", {
        room_id: "room-001",
      })) as { participants: unknown[]; count: number };

      expect(mockClient.getParticipants).toHaveBeenCalledWith("room-001");
      expect(result).toHaveProperty("participants");
      expect(result).toHaveProperty("count", mockParticipants.length);
    });
  });

  describe("thenvoi_create_chatroom", () => {
    it("should create room without task_id", async () => {
      mockClient.createChatroom.mockResolvedValue(mockCreateChatroomResponse);

      const result = await executeMcpTool("thenvoi_create_chatroom", {});

      expect(mockClient.createChatroom).toHaveBeenCalledWith(undefined);
      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("room_id");
    });

    it("should create room with task_id", async () => {
      mockClient.createChatroom.mockResolvedValue(mockCreateChatroomResponse);

      await executeMcpTool("thenvoi_create_chatroom", { task_id: "task-123" });

      expect(mockClient.createChatroom).toHaveBeenCalledWith("task-123");
    });
  });

  describe("thenvoi_send_event", () => {
    it("should send thought event", async () => {
      mockClient.sendMessage.mockResolvedValue(mockSendMessageResponse);

      const result = await executeMcpTool("thenvoi_send_event", {
        room_id: "room-001",
        content: "Thinking about this...",
        message_type: "thought",
      });

      expect(mockClient.sendMessage).toHaveBeenCalledWith(
        "room-001",
        "Thinking about this...",
        [],
        "thought",
      );
      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("message_type", "thought");
    });

    it("should send error event", async () => {
      mockClient.sendMessage.mockResolvedValue(mockSendMessageResponse);

      await executeMcpTool("thenvoi_send_event", {
        room_id: "room-001",
        content: "Something went wrong",
        message_type: "error",
      });

      expect(mockClient.sendMessage).toHaveBeenCalledWith(
        "room-001",
        "Something went wrong",
        [],
        "error",
      );
    });

    it("should send task event", async () => {
      mockClient.sendMessage.mockResolvedValue(mockSendMessageResponse);

      await executeMcpTool("thenvoi_send_event", {
        room_id: "room-001",
        content: "Task 50% complete",
        message_type: "task",
      });

      expect(mockClient.sendMessage).toHaveBeenCalledWith(
        "room-001",
        "Task 50% complete",
        [],
        "task",
      );
    });
  });
});
