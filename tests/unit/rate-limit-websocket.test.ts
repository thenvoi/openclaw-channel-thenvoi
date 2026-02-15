import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import type { IncomingMessage, ClientRequest } from "http";

// Mock the ws module before importing RateLimitAwareWebSocket
vi.mock("ws", () => {
  return {
    default: class MockWebSocket extends EventEmitter {
      constructor(
        public address: string,
        public protocols?: string | string[],
      ) {
        super();
      }
    },
  };
});

// Import after mocking
import { RateLimitAwareWebSocket } from "../../src/rate-limit-websocket.js";

describe("RateLimitAwareWebSocket", () => {
  let ws: RateLimitAwareWebSocket;

  beforeEach(() => {
    ws = new RateLimitAwareWebSocket("wss://test.example.com/socket");
  });

  describe("constructor", () => {
    it("should initialize with null rateLimitRetryAfterMs", () => {
      expect(ws.rateLimitRetryAfterMs).toBeNull();
    });

    it("should pass address and protocols to parent", () => {
      const wsWithProtocols = new RateLimitAwareWebSocket(
        "wss://test.example.com",
        ["protocol1"],
      );
      expect(wsWithProtocols.address).toBe("wss://test.example.com");
      expect(wsWithProtocols.protocols).toEqual(["protocol1"]);
    });
  });

  describe("unexpected-response handling", () => {
    function createMockResponse(
      statusCode: number,
      headers: Record<string, string> = {},
    ): IncomingMessage {
      return {
        statusCode,
        headers,
      } as IncomingMessage;
    }

    it("should set rateLimitRetryAfterMs when receiving 429 response", () => {
      const mockReq = {} as ClientRequest;
      const mockRes = createMockResponse(429);

      ws.emit("unexpected-response", mockReq, mockRes);

      // Should use default 30 seconds when no Retry-After header
      expect(ws.rateLimitRetryAfterMs).toBe(30_000);
    });

    it("should parse Retry-After header as seconds", () => {
      const mockReq = {} as ClientRequest;
      const mockRes = createMockResponse(429, { "retry-after": "60" });

      ws.emit("unexpected-response", mockReq, mockRes);

      expect(ws.rateLimitRetryAfterMs).toBe(60_000);
    });

    it("should parse Retry-After header as HTTP date", () => {
      const mockReq = {} as ClientRequest;
      const futureDate = new Date(Date.now() + 45_000);
      const mockRes = createMockResponse(429, {
        "retry-after": futureDate.toUTCString(),
      });

      ws.emit("unexpected-response", mockReq, mockRes);

      // Should be approximately 45 seconds (allow some tolerance for test timing)
      expect(ws.rateLimitRetryAfterMs).toBeGreaterThan(40_000);
      expect(ws.rateLimitRetryAfterMs).toBeLessThan(50_000);
    });

    it("should not set rateLimitRetryAfterMs for non-429 responses", () => {
      const mockReq = {} as ClientRequest;
      const mockRes = createMockResponse(500);

      ws.emit("unexpected-response", mockReq, mockRes);

      expect(ws.rateLimitRetryAfterMs).toBeNull();
    });

    it("should not set rateLimitRetryAfterMs for 401 responses", () => {
      const mockReq = {} as ClientRequest;
      const mockRes = createMockResponse(401);

      ws.emit("unexpected-response", mockReq, mockRes);

      expect(ws.rateLimitRetryAfterMs).toBeNull();
    });

    it("should handle malformed Retry-After header gracefully", () => {
      const mockReq = {} as ClientRequest;
      const mockRes = createMockResponse(429, { "retry-after": "invalid" });

      ws.emit("unexpected-response", mockReq, mockRes);

      // Should fall back to default 30 seconds
      expect(ws.rateLimitRetryAfterMs).toBe(30_000);
    });

    it("should handle past date in Retry-After header", () => {
      const mockReq = {} as ClientRequest;
      const pastDate = new Date(Date.now() - 10_000);
      const mockRes = createMockResponse(429, {
        "retry-after": pastDate.toUTCString(),
      });

      ws.emit("unexpected-response", mockReq, mockRes);

      // Should use 0 for past dates (Math.max(0, ...))
      expect(ws.rateLimitRetryAfterMs).toBe(0);
    });

    it("should handle zero Retry-After header", () => {
      const mockReq = {} as ClientRequest;
      const mockRes = createMockResponse(429, { "retry-after": "0" });

      ws.emit("unexpected-response", mockReq, mockRes);

      expect(ws.rateLimitRetryAfterMs).toBe(0);
    });

    it("should handle large Retry-After header values", () => {
      const mockReq = {} as ClientRequest;
      const mockRes = createMockResponse(429, { "retry-after": "3600" }); // 1 hour

      ws.emit("unexpected-response", mockReq, mockRes);

      expect(ws.rateLimitRetryAfterMs).toBe(3_600_000);
    });
  });
});
