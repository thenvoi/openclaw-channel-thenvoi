/**
 * Integration tests for message flow.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ThenvoiClient } from "../../src/thenvoi-client.js";
import { createMockFetch, mockFetchOnce } from "../__mocks__/fetch.js";
import { mockThenvoiConfig } from "../fixtures/configs.js";
import {
  mockSendMessageResponse,
  mockNextMessageResponse,
} from "../fixtures/payloads.js";

describe("Message Flow Integration", () => {
  let client: ThenvoiClient;
  let fetchMock: ReturnType<typeof createMockFetch>;

  beforeEach(() => {
    fetchMock = createMockFetch({ response: {} });
    globalThis.fetch = fetchMock;
    client = new ThenvoiClient(mockThenvoiConfig);
  });

  describe("Send and receive message flow", () => {
    it("should send a message successfully", async () => {
      mockFetchOnce(fetchMock, { response: mockSendMessageResponse });

      const result = await client.sendMessage(
        "room-001",
        "Hello, world!",
        ["User"],
      );

      expect(result.id).toBe("msg-new-001");
      expect(result.status).toBe("sent");
    });

    it("should process backlog messages", async () => {
      // First call returns a message
      mockFetchOnce(fetchMock, { response: mockNextMessageResponse });
      // Second call returns no more messages
      mockFetchOnce(fetchMock, { response: { message: "no_pending_messages" } });

      const message1 = await client.getNextMessage();
      expect(message1).not.toBeNull();
      expect(message1?.id).toBe("msg-backlog-001");

      const message2 = await client.getNextMessage();
      expect(message2).toBeNull();
    });
  });

  describe("Message status tracking", () => {
    it("should mark message as processing then processed", async () => {
      mockFetchOnce(fetchMock, { status: 204, response: undefined });
      mockFetchOnce(fetchMock, { status: 204, response: undefined });

      await client.markMessageProcessing("room-001", "msg-001");
      await client.markMessageProcessed("room-001", "msg-001");

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("should mark message as failed on error", async () => {
      mockFetchOnce(fetchMock, { status: 204, response: undefined });

      await client.markMessageFailed(
        "room-001",
        "msg-001",
        "Processing failed",
      );

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/failed"),
        expect.objectContaining({
          body: JSON.stringify({ error: "Processing failed" }),
        }),
      );
    });
  });

  describe("Concurrent operations", () => {
    it("should handle multiple concurrent API calls", async () => {
      // Set up responses for all calls
      for (let i = 0; i < 3; i++) {
        mockFetchOnce(fetchMock, { response: mockSendMessageResponse });
      }

      const results = await Promise.all([
        client.sendMessage("room-001", "Message 1", ["User"]),
        client.sendMessage("room-001", "Message 2", ["User"]),
        client.sendMessage("room-001", "Message 3", ["User"]),
      ]);

      expect(results).toHaveLength(3);
      results.forEach((r) => expect(r.id).toBeDefined());
    });
  });
});
