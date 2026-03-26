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
  mockListContactsResponse,
  mockAddContactResponse,
  mockListContactRequestsResponse,
  mockRespondContactRequestResponse,
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

    it("should clamp invalid pagination to valid ranges", async () => {
      mockRest.listPeers.mockResolvedValue(mockLookupPeersResponse);

      await executeMcpTool("thenvoi_lookup_peers", { page: -1, page_size: 200 });

      expect(mockRest.listPeers).toHaveBeenCalledWith({ page: 1, pageSize: 100, notInChat: "" });
    });

    it("should clamp page zero to 1", async () => {
      mockRest.listPeers.mockResolvedValue(mockLookupPeersResponse);

      await executeMcpTool("thenvoi_lookup_peers", { page: 0, page_size: 50 });

      expect(mockRest.listPeers).toHaveBeenCalledWith({ page: 1, pageSize: 50, notInChat: "" });
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

    it("should paginate through peers to find a match on page 2", async () => {
      const page1Response = {
        data: [{ id: "agent-a", name: "Agent A", type: "Agent", handle: "@agent-a" }],
        metadata: { page: 1, pageSize: 100, totalCount: 2, totalPages: 2 },
      };
      const page2Response = {
        data: [{ id: "agent-b", name: "Agent B", type: "Agent", handle: "@agent-b" }],
        metadata: { page: 2, pageSize: 100, totalCount: 2, totalPages: 2 },
      };
      mockRest.listPeers
        .mockResolvedValueOnce(page1Response)
        .mockResolvedValueOnce(page2Response);
      mockRest.addChatParticipant.mockResolvedValue(mockAddParticipantResponse);

      const result = await executeMcpTool("thenvoi_add_participant", {
        room_id: "room-001",
        handle: "Agent B",
      });

      expect(mockRest.listPeers).toHaveBeenCalledTimes(2);
      expect(mockRest.addChatParticipant).toHaveBeenCalledWith(
        "room-001",
        { participantId: "agent-b", role: "member" },
      );
      expect(result).toHaveProperty("success", true);
    });

    it("should stop paginating after max pages (10) to prevent runaway calls", async () => {
      // Return pages with no match, claiming 20 total pages
      const noMatchPage = {
        data: [{ id: "agent-other", name: "Other Agent", type: "Agent", handle: "@other" }],
        metadata: { page: 1, pageSize: 100, totalCount: 2000, totalPages: 20 },
      };
      mockRest.listPeers.mockResolvedValue(noMatchPage);

      await expect(
        executeMcpTool("thenvoi_add_participant", {
          room_id: "room-001",
          handle: "Nonexistent User",
        }),
      ).rejects.toThrow('Peer not found: "Nonexistent User"');

      // Should have stopped at 10 pages, not 20
      expect(mockRest.listPeers).toHaveBeenCalledTimes(10);
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
    it("should resolve name to ID and call removeChatParticipant", async () => {
      mockRest.listChatParticipants.mockResolvedValue(mockParticipants);
      mockRest.removeChatParticipant.mockResolvedValue({ ok: true });

      const result = await executeMcpTool("thenvoi_remove_participant", {
        room_id: "room-001",
        name: "John Doe",
      });

      expect(mockRest.listChatParticipants).toHaveBeenCalledWith("room-001");
      expect(mockRest.removeChatParticipant).toHaveBeenCalledWith(
        "room-001",
        "user-789",
      );
      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("message");
    });

    it("should use participant_id directly when provided", async () => {
      mockRest.removeChatParticipant.mockResolvedValue({ ok: true });

      const result = await executeMcpTool("thenvoi_remove_participant", {
        room_id: "room-001",
        participant_id: "user-789",
      });

      expect(mockRest.listChatParticipants).not.toHaveBeenCalled();
      expect(mockRest.removeChatParticipant).toHaveBeenCalledWith(
        "room-001",
        "user-789",
      );
      expect(result).toHaveProperty("success", true);
    });

    it("should throw when participant name not found in room", async () => {
      mockRest.listChatParticipants.mockResolvedValue(mockParticipants);

      await expect(
        executeMcpTool("thenvoi_remove_participant", {
          room_id: "room-001",
          name: "Unknown Person",
        }),
      ).rejects.toThrow('Participant "Unknown Person" not found in room');
    });

    it("should throw when neither name nor participant_id provided", async () => {
      await expect(
        executeMcpTool("thenvoi_remove_participant", {
          room_id: "room-001",
        }),
      ).rejects.toThrow("Either name or participant_id is required");
    });
  });

  describe("thenvoi_get_participants", () => {
    it("should return participants list with IDs", async () => {
      mockRest.listChatParticipants.mockResolvedValue(mockParticipants);

      const result = (await executeMcpTool("thenvoi_get_participants", {
        room_id: "room-001",
      })) as { participants: Array<{ id: string; name: string; type: string }>; count: number };

      expect(mockRest.listChatParticipants).toHaveBeenCalledWith("room-001");
      expect(result).toHaveProperty("participants");
      expect(result).toHaveProperty("count", mockParticipants.length);
      expect(result.participants[0]).toEqual({
        id: "user-789",
        name: "John Doe",
        type: "User",
      });
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

  describe("thenvoi_list_contacts", () => {
    it("should call listContacts with default pagination", async () => {
      mockRest.listContacts.mockResolvedValue(mockListContactsResponse);

      const result = await executeMcpTool("thenvoi_list_contacts", {});

      expect(mockRest.listContacts).toHaveBeenCalledWith({ page: 1, pageSize: 50 });
      expect(result).toHaveProperty("contacts");
      expect(result).toHaveProperty("metadata");
      const typed = result as { contacts: unknown[]; metadata: unknown };
      expect(typed.contacts).toHaveLength(2);
      expect(typed.contacts[0]).toEqual({
        id: "contact-001",
        handle: "@jane",
        name: "Jane Smith",
        type: "User",
      });
    });

    it("should call listContacts with provided pagination", async () => {
      mockRest.listContacts.mockResolvedValue(mockListContactsResponse);

      await executeMcpTool("thenvoi_list_contacts", { page: 3, page_size: 25 });

      expect(mockRest.listContacts).toHaveBeenCalledWith({ page: 3, pageSize: 25 });
    });

    it("should clamp invalid pagination to valid ranges", async () => {
      mockRest.listContacts.mockResolvedValue(mockListContactsResponse);

      await executeMcpTool("thenvoi_list_contacts", { page: 0, page_size: 999 });

      expect(mockRest.listContacts).toHaveBeenCalledWith({ page: 1, pageSize: 100 });
    });

    it("should throw when link not connected", async () => {
      vi.mocked(channel.getLink).mockReturnValue(undefined);

      await expect(executeMcpTool("thenvoi_list_contacts", {})).rejects.toThrow(
        "Thenvoi client not connected",
      );
    });
  });

  describe("thenvoi_add_contact", () => {
    it("should call addContact with handle", async () => {
      mockRest.addContact.mockResolvedValue(mockAddContactResponse);

      const result = await executeMcpTool("thenvoi_add_contact", {
        handle: "@jane",
      });

      expect(mockRest.addContact).toHaveBeenCalledWith({ handle: "@jane", message: undefined });
      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("id", "request-001");
      expect(result).toHaveProperty("status", "pending");
    });

    it("should call addContact with handle and message", async () => {
      mockRest.addContact.mockResolvedValue(mockAddContactResponse);

      await executeMcpTool("thenvoi_add_contact", {
        handle: "@jane",
        message: "Let's collaborate!",
      });

      expect(mockRest.addContact).toHaveBeenCalledWith({
        handle: "@jane",
        message: "Let's collaborate!",
      });
    });

    it("should throw when link not connected", async () => {
      vi.mocked(channel.getLink).mockReturnValue(undefined);

      await expect(
        executeMcpTool("thenvoi_add_contact", { handle: "@jane" }),
      ).rejects.toThrow("Thenvoi client not connected");
    });
  });

  describe("thenvoi_remove_contact", () => {
    it("should call removeContact with handle", async () => {
      mockRest.removeContact.mockResolvedValue({ ok: true });

      const result = await executeMcpTool("thenvoi_remove_contact", {
        handle: "@jane",
      });

      expect(mockRest.removeContact).toHaveBeenCalledWith({
        target: "handle",
        handle: "@jane",
      });
      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("message", "Contact removed");
    });

    it("should call removeContact with contact_id", async () => {
      mockRest.removeContact.mockResolvedValue({ ok: true });

      const result = await executeMcpTool("thenvoi_remove_contact", {
        contact_id: "contact-001",
      });

      expect(mockRest.removeContact).toHaveBeenCalledWith({
        target: "contactId",
        contactId: "contact-001",
      });
      expect(result).toHaveProperty("success", true);
    });

    it("should throw when neither handle nor contact_id provided", async () => {
      await expect(
        executeMcpTool("thenvoi_remove_contact", {}),
      ).rejects.toThrow("Either handle or contact_id is required");
    });

    it("should throw when link not connected", async () => {
      vi.mocked(channel.getLink).mockReturnValue(undefined);

      await expect(
        executeMcpTool("thenvoi_remove_contact", { handle: "@jane" }),
      ).rejects.toThrow("Thenvoi client not connected");
    });
  });

  describe("thenvoi_list_contact_requests", () => {
    it("should call listContactRequests with default params", async () => {
      mockRest.listContactRequests.mockResolvedValue(mockListContactRequestsResponse);

      const result = await executeMcpTool("thenvoi_list_contact_requests", {});

      expect(mockRest.listContactRequests).toHaveBeenCalledWith({
        page: 1,
        pageSize: 50,
        sentStatus: "pending",
      });
      expect(result).toHaveProperty("received");
      expect(result).toHaveProperty("sent");
      expect(result).toHaveProperty("metadata");
      const typed = result as { received: unknown[]; sent: unknown[] };
      expect(typed.received).toHaveLength(1);
      expect(typed.received[0]).toEqual({
        id: "req-recv-001",
        from_handle: "@alice",
        from_name: "Alice",
        message: "Hi, let's connect!",
        status: "pending",
      });
      expect(typed.sent).toHaveLength(1);
      expect(typed.sent[0]).toEqual({
        id: "req-sent-001",
        to_handle: "@bob",
        to_name: "Bob",
        message: "Want to collaborate?",
        status: "pending",
      });
    });

    it("should call listContactRequests with provided params", async () => {
      mockRest.listContactRequests.mockResolvedValue(mockListContactRequestsResponse);

      await executeMcpTool("thenvoi_list_contact_requests", {
        page: 2,
        page_size: 10,
        sent_status: "approved",
      });

      expect(mockRest.listContactRequests).toHaveBeenCalledWith({
        page: 2,
        pageSize: 10,
        sentStatus: "approved",
      });
    });

    it("should clamp invalid pagination to valid ranges", async () => {
      mockRest.listContactRequests.mockResolvedValue(mockListContactRequestsResponse);

      await executeMcpTool("thenvoi_list_contact_requests", {
        page: -5,
        page_size: 150,
      });

      expect(mockRest.listContactRequests).toHaveBeenCalledWith({
        page: 1,
        pageSize: 100,
        sentStatus: "pending",
      });
    });

    it("should throw when link not connected", async () => {
      vi.mocked(channel.getLink).mockReturnValue(undefined);

      await expect(
        executeMcpTool("thenvoi_list_contact_requests", {}),
      ).rejects.toThrow("Thenvoi client not connected");
    });
  });

  describe("thenvoi_respond_contact_request", () => {
    it("should approve a request by handle", async () => {
      mockRest.respondContactRequest.mockResolvedValue(mockRespondContactRequestResponse);

      const result = await executeMcpTool("thenvoi_respond_contact_request", {
        action: "approve",
        handle: "@alice",
      });

      expect(mockRest.respondContactRequest).toHaveBeenCalledWith({
        action: "approve",
        target: "handle",
        handle: "@alice",
      });
      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("id", "req-recv-001");
      expect(result).toHaveProperty("status", "approved");
    });

    it("should reject a request by request_id", async () => {
      mockRest.respondContactRequest.mockResolvedValue({ id: "req-recv-001", status: "rejected" });

      const result = await executeMcpTool("thenvoi_respond_contact_request", {
        action: "reject",
        request_id: "req-recv-001",
      });

      expect(mockRest.respondContactRequest).toHaveBeenCalledWith({
        action: "reject",
        target: "requestId",
        requestId: "req-recv-001",
      });
      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("status", "rejected");
    });

    it("should cancel a sent request by handle", async () => {
      mockRest.respondContactRequest.mockResolvedValue({ id: "req-sent-001", status: "cancelled" });

      const result = await executeMcpTool("thenvoi_respond_contact_request", {
        action: "cancel",
        handle: "@bob",
      });

      expect(mockRest.respondContactRequest).toHaveBeenCalledWith({
        action: "cancel",
        target: "handle",
        handle: "@bob",
      });
      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("status", "cancelled");
    });

    it("should throw when neither handle nor request_id provided", async () => {
      await expect(
        executeMcpTool("thenvoi_respond_contact_request", { action: "approve" }),
      ).rejects.toThrow("Either handle or request_id is required");
    });

    it("should throw when link not connected", async () => {
      vi.mocked(channel.getLink).mockReturnValue(undefined);

      await expect(
        executeMcpTool("thenvoi_respond_contact_request", {
          action: "approve",
          handle: "@alice",
        }),
      ).rejects.toThrow("Thenvoi client not connected");
    });
  });
});
