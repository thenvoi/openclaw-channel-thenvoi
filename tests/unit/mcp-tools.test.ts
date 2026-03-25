/**
 * Unit tests for MCP tools.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  executeMcpTool,
  getMcpTool,
  getMcpToolRegistrations,
  getMcpToolSchemas,
  mcpTools,
} from "../../src/mcp-tools.js";
import * as channel from "../../src/channel.js";

vi.mock("../../src/channel.js", () => ({
  getClient: vi.fn(),
}));

describe("MCP tools", () => {
  const mockClient = {
    sendMessage: vi.fn(),
    sendEvent: vi.fn(),
    createChat: vi.fn(),
    getParticipants: vi.fn(),
    addParticipant: vi.fn(),
    removeParticipant: vi.fn(),
    lookupPeers: vi.fn(),
    listContacts: vi.fn(),
    addContact: vi.fn(),
    removeContact: vi.fn(),
    listContactRequests: vi.fn(),
    respondContactRequest: vi.fn(),
    listMemories: vi.fn(),
    storeMemory: vi.fn(),
    getMemory: vi.fn(),
    supersedeMemory: vi.fn(),
    archiveMemory: vi.fn(),
    getNextMessage: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(channel.getClient).mockReturnValue(mockClient as unknown as ReturnType<typeof channel.getClient>);
  });

  it("exposes the SDK-backed tool set", () => {
    expect(mcpTools).toHaveLength(17);
    expect(getMcpToolRegistrations()).toHaveLength(17);
    expect(new Set(mcpTools.map((tool) => tool.name)).size).toBe(17);
  });

  it("builds schemas without execute handlers", () => {
    const schemas = getMcpToolSchemas();

    expect(schemas).toHaveLength(17);
    schemas.forEach((schema) => {
      expect(schema).toHaveProperty("name");
      expect(schema).toHaveProperty("description");
      expect(schema).toHaveProperty("inputSchema");
      expect(schema).not.toHaveProperty("execute");
    });
  });

  it("adds room_id only to room-scoped tools", () => {
    const sendMessage = getMcpTool("thenvoi_send_message");
    const lookupPeers = getMcpTool("thenvoi_lookup_peers");

    expect(sendMessage?.inputSchema.required).toContain("room_id");
    expect(lookupPeers?.inputSchema.required ?? []).not.toContain("room_id");
  });

  it("returns an MCP error result when the client is unavailable", async () => {
    vi.mocked(channel.getClient).mockReturnValue(undefined);

    await expect(executeMcpTool("thenvoi_lookup_peers", {})).rejects.toThrow(
      "Thenvoi client not connected",
    );
  });

  it("executes single-context tools through the SDK registration builder", async () => {
    mockClient.lookupPeers.mockResolvedValue({
      peers: [{ id: "agent-weather", name: "Weather Agent", type: "Agent" }],
      page: 1,
      page_size: 50,
      total_count: 1,
      has_more: false,
    });

    const result = await executeMcpTool("thenvoi_lookup_peers", {});

    expect(mockClient.lookupPeers).toHaveBeenCalledWith(1, 50);
    expect(result).toEqual({
      data: [{ id: "agent-weather", name: "Weather Agent", type: "Agent" }],
      metadata: { page: 1, page_size: 50, total_count: 1, total_pages: 1 },
    });
  });

  it("executes room-scoped tools through the SDK registration builder", async () => {
    mockClient.sendEvent.mockResolvedValue({ id: "event-001", ok: true });

    const result = await executeMcpTool("thenvoi_send_event", {
      room_id: "room-001",
      content: "Thinking...",
      message_type: "thought",
    });

    expect(mockClient.sendEvent).toHaveBeenCalledWith(
      "room-001",
      "Thinking...",
      "thought",
      undefined,
    );
    expect(result).toEqual({ id: "event-001", ok: true });
  });

  it("reports a missing room_id as an MCP error result", async () => {
    await expect(
      executeMcpTool("thenvoi_send_message", {
        content: "Hello",
        mentions: ["John Doe"],
      }),
    ).rejects.toThrow("Missing required room_id");
  });

  it("throws for unknown tools", async () => {
    await expect(executeMcpTool("unknown_tool", {})).rejects.toThrow(
      "Unknown tool: unknown_tool",
    );
  });
});
