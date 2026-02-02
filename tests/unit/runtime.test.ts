/**
 * Unit tests for ThenvoiRuntime.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ThenvoiRuntime, type RuntimeCallbacks } from "../../src/runtime.js";
import { ThenvoiClient } from "../../src/thenvoi-client.js";
import { mockThenvoiConfig } from "../fixtures/configs.js";
import { createMockFetch } from "../__mocks__/fetch.js";

describe("ThenvoiRuntime", () => {
  let runtime: ThenvoiRuntime;
  let callbacks: RuntimeCallbacks;
  let mockOnMessage: ReturnType<typeof vi.fn>;
  let mockOnRoomJoined: ReturnType<typeof vi.fn>;
  let mockOnRoomLeft: ReturnType<typeof vi.fn>;
  let mockOnParticipantJoined: ReturnType<typeof vi.fn>;
  let mockOnParticipantLeft: ReturnType<typeof vi.fn>;
  let mockOnError: ReturnType<typeof vi.fn>;
  let mockOnReconnecting: ReturnType<typeof vi.fn>;
  let mockOnReconnected: ReturnType<typeof vi.fn>;
  let mockOnSyncStarted: ReturnType<typeof vi.fn>;
  let mockOnSyncCompleted: ReturnType<typeof vi.fn>;
  let mockOnSyncError: ReturnType<typeof vi.fn>;
  let fetchMock: ReturnType<typeof createMockFetch>;
  let mockClient: ThenvoiClient;

  beforeEach(() => {
    // Set up fetch mock
    fetchMock = createMockFetch({ response: { message: "no_pending_messages" } });
    globalThis.fetch = fetchMock;

    mockOnMessage = vi.fn();
    mockOnRoomJoined = vi.fn();
    mockOnRoomLeft = vi.fn();
    mockOnParticipantJoined = vi.fn();
    mockOnParticipantLeft = vi.fn();
    mockOnError = vi.fn();
    mockOnReconnecting = vi.fn();
    mockOnReconnected = vi.fn();
    mockOnSyncStarted = vi.fn();
    mockOnSyncCompleted = vi.fn();
    mockOnSyncError = vi.fn();

    callbacks = {
      onMessage: mockOnMessage,
      onRoomJoined: mockOnRoomJoined,
      onRoomLeft: mockOnRoomLeft,
      onParticipantJoined: mockOnParticipantJoined,
      onParticipantLeft: mockOnParticipantLeft,
      onError: mockOnError,
      onReconnecting: mockOnReconnecting,
      onReconnected: mockOnReconnected,
      onSyncStarted: mockOnSyncStarted,
      onSyncCompleted: mockOnSyncCompleted,
      onSyncError: mockOnSyncError,
    };

    mockClient = new ThenvoiClient(mockThenvoiConfig);
    runtime = new ThenvoiRuntime(mockThenvoiConfig, callbacks, mockClient);
  });

  describe("constructor", () => {
    it("should create runtime with config and callbacks", () => {
      expect(runtime).toBeDefined();
      expect(runtime.isConnected()).toBe(false);
    });

    it("should create client if not provided", () => {
      const runtimeWithoutClient = new ThenvoiRuntime(
        mockThenvoiConfig,
        callbacks,
      );
      expect(runtimeWithoutClient).toBeDefined();
    });
  });

  describe("isConnected", () => {
    it("should return false initially", () => {
      expect(runtime.isConnected()).toBe(false);
    });
  });

  describe("getRooms", () => {
    it("should return empty map initially", () => {
      const rooms = runtime.getRooms();
      expect(rooms.size).toBe(0);
    });

    it("should return a defensive copy", () => {
      const rooms1 = runtime.getRooms();
      const rooms2 = runtime.getRooms();
      expect(rooms1).not.toBe(rooms2);
    });
  });

  describe("isSyncing", () => {
    it("should return false initially", () => {
      expect(runtime.isSyncing()).toBe(false);
    });
  });

  describe("isReconnectingNow", () => {
    it("should return false initially", () => {
      expect(runtime.isReconnectingNow()).toBe(false);
    });
  });

  describe("getReconnectAttempt", () => {
    it("should return 0 initially", () => {
      expect(runtime.getReconnectAttempt()).toBe(0);
    });
  });

  describe("getProcessedMessageCount", () => {
    it("should return 0 initially", () => {
      expect(runtime.getProcessedMessageCount()).toBe(0);
    });
  });

  describe("clearProcessedMessageCache", () => {
    it("should not throw when called", () => {
      expect(() => runtime.clearProcessedMessageCache()).not.toThrow();
    });
  });

  describe("disconnect", () => {
    it("should set connected to false", async () => {
      await runtime.disconnect();
      expect(runtime.isConnected()).toBe(false);
    });

    it("should clear rooms", async () => {
      await runtime.disconnect();
      expect(runtime.getRooms().size).toBe(0);
    });

    it("should reset reconnect attempts", async () => {
      await runtime.disconnect();
      expect(runtime.getReconnectAttempt()).toBe(0);
    });

    it("should clear processed message cache", async () => {
      await runtime.disconnect();
      expect(runtime.getProcessedMessageCount()).toBe(0);
    });
  });

  describe("callbacks interface", () => {
    it("should accept all callback types", () => {
      const fullCallbacks: RuntimeCallbacks = {
        onMessage: vi.fn(),
        onRoomJoined: vi.fn(),
        onRoomLeft: vi.fn(),
        onParticipantJoined: vi.fn(),
        onParticipantLeft: vi.fn(),
        onError: vi.fn(),
        onReconnecting: vi.fn(),
        onReconnected: vi.fn(),
        onSyncStarted: vi.fn(),
        onSyncCompleted: vi.fn(),
        onSyncError: vi.fn(),
      };

      const runtimeWithFullCallbacks = new ThenvoiRuntime(
        mockThenvoiConfig,
        fullCallbacks,
        mockClient,
      );

      expect(runtimeWithFullCallbacks).toBeDefined();
    });

    it("should work with minimal callbacks", () => {
      const minimalCallbacks: RuntimeCallbacks = {
        onMessage: vi.fn(),
      };

      const runtimeWithMinimalCallbacks = new ThenvoiRuntime(
        mockThenvoiConfig,
        minimalCallbacks,
        mockClient,
      );

      expect(runtimeWithMinimalCallbacks).toBeDefined();
    });
  });
});
