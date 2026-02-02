/**
 * Unit tests for ThenvoiClient.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ThenvoiClient } from "../../src/thenvoi-client.js";
import { ThenvoiAuthError, ThenvoiError } from "../../src/types.js";
import { createMockFetch, mockFetchOnce } from "../__mocks__/fetch.js";
import { mockThenvoiConfig } from "../fixtures/configs.js";
import {
  mockAgentMetadata,
  mockSendMessageResponse,
  mockLookupPeersResponse,
  mockAddParticipantResponse,
  mockCreateChatroomResponse,
  mockParticipants,
  mockNextMessageResponse,
} from "../fixtures/payloads.js";

describe("ThenvoiClient", () => {
  let client: ThenvoiClient;
  let fetchMock: ReturnType<typeof createMockFetch>;

  beforeEach(() => {
    fetchMock = createMockFetch({ response: {} });
    globalThis.fetch = fetchMock;
    client = new ThenvoiClient(mockThenvoiConfig);
  });

  describe("constructor", () => {
    it("should strip trailing slash from baseUrl", () => {
      const configWithSlash = {
        ...mockThenvoiConfig,
        restUrl: "https://api.thenvoi.com/",
      };
      const clientWithSlash = new ThenvoiClient(configWithSlash);
      mockFetchOnce(fetchMock, { response: mockAgentMetadata });
      clientWithSlash.getAgentMe();
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.thenvoi.com/api/agent/me",
        expect.any(Object),
      );
    });
  });

  describe("getAgentMe", () => {
    it("should fetch agent metadata successfully", async () => {
      mockFetchOnce(fetchMock, { response: mockAgentMetadata });

      const result = await client.getAgentMe();

      expect(result).toEqual(mockAgentMetadata);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://test.thenvoi.com/api/agent/me",
        expect.objectContaining({
          method: "GET",
          headers: {
            Authorization: "Bearer test-api-key-12345",
            "Content-Type": "application/json",
            "X-Agent-ID": "agent-123",
          },
        }),
      );
    });

    it("should throw ThenvoiAuthError on 401", async () => {
      mockFetchOnce(fetchMock, {
        status: 401,
        ok: false,
        textResponse: "Unauthorized",
      });

      await expect(client.getAgentMe()).rejects.toThrow(ThenvoiAuthError);
    });

    it("should throw ThenvoiError on other HTTP errors", async () => {
      mockFetchOnce(fetchMock, {
        status: 500,
        ok: false,
        textResponse: "Internal Server Error",
      });

      await expect(client.getAgentMe()).rejects.toThrow(ThenvoiError);
    });

    it("should propagate network errors", async () => {
      fetchMock.mockRejectedValueOnce(new Error("Network error"));

      await expect(client.getAgentMe()).rejects.toThrow("Network error");
    });
  });

  describe("sendMessage", () => {
    it("should send message with correct payload", async () => {
      mockFetchOnce(fetchMock, { response: mockSendMessageResponse });

      const result = await client.sendMessage("room-001", "Hello!", ["John"]);

      expect(result).toEqual(mockSendMessageResponse);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://test.thenvoi.com/api/agent/messages",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            room_id: "room-001",
            content: "Hello!",
            message_type: "text",
            mentions: ["John"],
          }),
        }),
      );
    });

    it("should use empty mentions array when not provided", async () => {
      mockFetchOnce(fetchMock, { response: mockSendMessageResponse });

      await client.sendMessage("room-001", "Hello!");

      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"mentions":[]'),
        }),
      );
    });

    it("should send event messages with correct type", async () => {
      mockFetchOnce(fetchMock, { response: mockSendMessageResponse });

      await client.sendMessage("room-001", "Thinking...", [], "thought");

      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"message_type":"thought"'),
        }),
      );
    });
  });

  describe("markMessageProcessing", () => {
    it("should call correct endpoint", async () => {
      mockFetchOnce(fetchMock, { status: 204, response: undefined });

      await client.markMessageProcessing("room-001", "msg-001");

      expect(fetchMock).toHaveBeenCalledWith(
        "https://test.thenvoi.com/api/agent/chats/room-001/messages/msg-001/processing",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  describe("markMessageProcessed", () => {
    it("should call correct endpoint", async () => {
      mockFetchOnce(fetchMock, { status: 204, response: undefined });

      await client.markMessageProcessed("room-001", "msg-001");

      expect(fetchMock).toHaveBeenCalledWith(
        "https://test.thenvoi.com/api/agent/chats/room-001/messages/msg-001/processed",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  describe("markMessageFailed", () => {
    it("should send error in body", async () => {
      mockFetchOnce(fetchMock, { status: 204, response: undefined });

      await client.markMessageFailed("room-001", "msg-001", "Processing failed");

      expect(fetchMock).toHaveBeenCalledWith(
        "https://test.thenvoi.com/api/agent/chats/room-001/messages/msg-001/failed",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ error: "Processing failed" }),
        }),
      );
    });
  });

  describe("getNextMessage", () => {
    it("should return message when available", async () => {
      mockFetchOnce(fetchMock, { response: mockNextMessageResponse });

      const result = await client.getNextMessage();

      expect(result).toEqual(mockNextMessageResponse);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://test.thenvoi.com/api/agent/next",
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("should return null when no messages", async () => {
      mockFetchOnce(fetchMock, {
        response: { message: "no_pending_messages" },
      });

      const result = await client.getNextMessage();

      expect(result).toBeNull();
    });

    it("should return null on 404", async () => {
      mockFetchOnce(fetchMock, { status: 404, ok: false });

      const result = await client.getNextMessage();

      expect(result).toBeNull();
    });

    it("should throw on other errors", async () => {
      mockFetchOnce(fetchMock, { status: 500, ok: false });

      await expect(client.getNextMessage()).rejects.toThrow(ThenvoiError);
    });
  });

  describe("lookupPeers", () => {
    it("should use default pagination", async () => {
      mockFetchOnce(fetchMock, { response: mockLookupPeersResponse });

      const result = await client.lookupPeers();

      expect(result).toEqual(mockLookupPeersResponse);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://test.thenvoi.com/api/peers?page=1&page_size=50",
        expect.any(Object),
      );
    });

    it("should use provided pagination", async () => {
      mockFetchOnce(fetchMock, { response: mockLookupPeersResponse });

      await client.lookupPeers(2, 25);

      expect(fetchMock).toHaveBeenCalledWith(
        "https://test.thenvoi.com/api/peers?page=2&page_size=25",
        expect.any(Object),
      );
    });
  });

  describe("addParticipant", () => {
    it("should send correct payload with default role", async () => {
      mockFetchOnce(fetchMock, { response: mockAddParticipantResponse });

      const result = await client.addParticipant("room-001", "Weather Agent");

      expect(result).toEqual(mockAddParticipantResponse);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://test.thenvoi.com/api/rooms/room-001/participants",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ name: "Weather Agent", role: "member" }),
        }),
      );
    });

    it("should use provided role", async () => {
      mockFetchOnce(fetchMock, { response: mockAddParticipantResponse });

      await client.addParticipant("room-001", "Admin User", "admin");

      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ name: "Admin User", role: "admin" }),
        }),
      );
    });
  });

  describe("removeParticipant", () => {
    it("should URL encode participant name", async () => {
      mockFetchOnce(fetchMock, { status: 204, response: undefined });

      await client.removeParticipant("room-001", "Weather Agent");

      expect(fetchMock).toHaveBeenCalledWith(
        "https://test.thenvoi.com/api/rooms/room-001/participants/Weather%20Agent",
        expect.objectContaining({ method: "DELETE" }),
      );
    });
  });

  describe("getParticipants", () => {
    it("should return participants array", async () => {
      mockFetchOnce(fetchMock, { response: { participants: mockParticipants } });

      const result = await client.getParticipants("room-001");

      expect(result).toEqual(mockParticipants);
    });
  });

  describe("createChatroom", () => {
    it("should create room without task_id", async () => {
      mockFetchOnce(fetchMock, { response: mockCreateChatroomResponse });

      const result = await client.createChatroom();

      expect(result).toEqual(mockCreateChatroomResponse);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://test.thenvoi.com/api/rooms",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({}),
        }),
      );
    });

    it("should create room with task_id", async () => {
      mockFetchOnce(fetchMock, { response: mockCreateChatroomResponse });

      await client.createChatroom("task-123");

      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ task_id: "task-123" }),
        }),
      );
    });
  });

  describe("HTTP response handling", () => {
    it("should handle 204 No Content responses", async () => {
      mockFetchOnce(fetchMock, { status: 204, response: undefined });

      const result = await client.markMessageProcessing("room-001", "msg-001");

      expect(result).toBeUndefined();
    });
  });
});
