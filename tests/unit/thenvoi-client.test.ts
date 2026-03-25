/**
 * Unit tests for ThenvoiClient.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import { ThenvoiClient } from "../../src/thenvoi-client.js";
import { createMockFetch, mockFetchOnce } from "../__mocks__/fetch.js";
import { mockThenvoiConfig } from "../fixtures/configs.js";
import {
  mockAgentMetadata,
  mockNextMessageResponse,
  mockParticipants,
} from "../fixtures/payloads.js";

describe("ThenvoiClient", () => {
  let client: ThenvoiClient;
  let fetchMock: ReturnType<typeof createMockFetch>;

  beforeEach(() => {
    fetchMock = createMockFetch({ response: {} });
    globalThis.fetch = fetchMock;
    client = new ThenvoiClient(mockThenvoiConfig);
  });

  it("strips a trailing slash from restUrl", async () => {
    const clientWithSlash = new ThenvoiClient({
      ...mockThenvoiConfig,
      restUrl: "https://app.thenvoi.com/",
    });
    mockFetchOnce(fetchMock, { response: mockAgentMetadata });

    await clientWithSlash.getAgentMe();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://app.thenvoi.com/api/v1/agent/me",
      expect.any(Object),
    );
  });

  it("fetches agent metadata", async () => {
    mockFetchOnce(fetchMock, { response: mockAgentMetadata });

    await expect(client.getAgentMe()).resolves.toEqual({
      ...mockAgentMetadata,
      status: "active",
    });
  });

  it("sends chat messages through the SDK REST client", async () => {
    mockFetchOnce(fetchMock, { response: { id: "msg-new-001" } });

    const result = await client.sendMessage("room-001", "Hello!", [
      { id: "user-1", name: "John" },
    ]);

    expect(result).toEqual({
      id: "msg-new-001",
      chat_room_id: "room-001",
      recipients: [{ id: "user-1", name: "John" }],
      success: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://test.thenvoi.com/api/v1/agent/chats/room-001/messages",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          message: {
            content: "Hello!",
            mentions: [{ id: "user-1", name: "John" }],
          },
        }),
      }),
    );
  });

  it("sends events through the SDK REST client", async () => {
    mockFetchOnce(fetchMock, { response: { id: "event-001" } });

    const result = await client.sendEvent("room-001", "Thinking...", "thought");

    expect(result).toEqual({
      id: "event-001",
      chat_room_id: "room-001",
      message_type: "thought",
      success: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://test.thenvoi.com/api/v1/agent/chats/room-001/events",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("returns null for backlog polling without a room id", async () => {
    await expect(client.getNextMessage()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches the next room-scoped backlog message", async () => {
    mockFetchOnce(fetchMock, { response: mockNextMessageResponse });

    await expect(client.getNextMessage("room-001")).resolves.toEqual(mockNextMessageResponse);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://test.thenvoi.com/api/v1/agent/chats/room-001/messages/next",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("lists peers with the SDK pagination query shape", async () => {
    mockFetchOnce(fetchMock, {
      response: {
        data: [{ id: "agent-weather", name: "Weather Agent", type: "Agent" }],
        metadata: { page: 2, pageSize: 25, totalCount: 1, totalPages: 1 },
      },
    });

    const result = await client.lookupPeers(2, 25);

    expect(result).toEqual({
      peers: [{ id: "agent-weather", name: "Weather Agent", type: "Agent" }],
      page: 2,
      page_size: 25,
      total_count: 1,
      has_more: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://test.thenvoi.com/api/v1/agent/peers?not_in_chat=&page=2&page_size=25",
      expect.any(Object),
    );
  });

  it("adds a participant and hydrates the participant details from the room list", async () => {
    mockFetchOnce(fetchMock, { response: { ok: true } });
    mockFetchOnce(fetchMock, { response: { data: mockParticipants } });

    const result = await client.addParticipant("room-001", "agent-123");

    expect(result).toEqual({
      id: "agent-123",
      name: "Test Agent",
      type: "Agent",
      role: "member",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://test.thenvoi.com/api/v1/agent/chats/room-001/participants",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://test.thenvoi.com/api/v1/agent/chats/room-001/participants",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("lists participants through the SDK REST facade", async () => {
    mockFetchOnce(fetchMock, { response: { data: mockParticipants } });

    await expect(client.getParticipants("room-001")).resolves.toEqual(mockParticipants);
  });

  it("creates chat rooms through the SDK REST facade", async () => {
    mockFetchOnce(fetchMock, { response: { id: "room-new-001" } });

    await expect(client.createChat("task-123")).resolves.toEqual({
      id: "room-new-001",
      inserted_at: "",
      updated_at: "",
      task_id: "task-123",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://test.thenvoi.com/api/v1/agent/chats",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
