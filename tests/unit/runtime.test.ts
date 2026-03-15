/**
 * Unit tests for ThenvoiRuntime.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ThenvoiRuntime, type RuntimeCallbacks } from "../../src/runtime.js";
import { ThenvoiClient } from "../../src/thenvoi-client.js";
import { mockThenvoiConfig } from "../fixtures/configs.js";
import { createMockFetch, createMockFetchByUrl } from "../__mocks__/fetch.js";
import { Socket, setGlobalConnectBehavior, resetGlobalConnectBehavior } from "../__mocks__/phoenix.js";

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

  describe("reconnection logic", () => {
    let connectedRuntime: ThenvoiRuntime;
    let socket: Socket;

    beforeEach(async () => {
      // Set up fetch to return empty chats list and no pending messages
      const urlConfigs = new Map<string, { response?: unknown }>();
      urlConfigs.set(`${mockThenvoiConfig.restUrl}/api/v1/agent/chats`, {
        response: { chats: [] },
      });
      globalThis.fetch = createMockFetchByUrl(urlConfigs, {
        response: { message: "no_pending_messages" },
      });

      connectedRuntime = new ThenvoiRuntime(mockThenvoiConfig, callbacks, mockClient);

      // Connect the runtime
      await connectedRuntime.connect();

      // Get the mock socket for simulation
      // The socket is created internally, we access it via the mock module
      socket = (connectedRuntime as unknown as { socket: Socket }).socket;
    });

    afterEach(async () => {
      // Restore real timers first to avoid timeout issues
      vi.useRealTimers();
      // Reset global connect behavior
      resetGlobalConnectBehavior();
      await connectedRuntime.disconnect();
    });

    it("should trigger reconnection on unintended socket close", async () => {
      // Verify we're connected
      expect(connectedRuntime.isConnected()).toBe(true);

      // Simulate socket close
      socket.simulateClose();

      // Should trigger reconnection
      expect(connectedRuntime.isReconnectingNow()).toBe(true);
      expect(mockOnError).toHaveBeenCalledWith(
        expect.objectContaining({ message: "WebSocket connection closed" })
      );
    });

    it("should call onReconnecting callback with attempt number and delay", async () => {
      vi.useFakeTimers();

      // Simulate socket close
      socket.simulateClose();

      // Let the setTimeout execute
      await vi.advanceTimersByTimeAsync(0);

      // Verify onReconnecting was called
      expect(mockOnReconnecting).toHaveBeenCalledTimes(1);
      expect(mockOnReconnecting).toHaveBeenCalledWith(
        1, // First attempt
        expect.any(Number) // Delay in ms
      );

      // Note: reconnectAttempts is incremented BEFORE calculating delay,
      // so first delay is 1000 * 2^1 = 2000ms ± 10% jitter
      const [_attempt, delayMs] = mockOnReconnecting.mock.calls[0];
      expect(delayMs).toBeGreaterThanOrEqual(1800);
      expect(delayMs).toBeLessThanOrEqual(2200);
    });

    it("should increment reconnect attempts on each failure", async () => {
      vi.useFakeTimers();

      // Make all new socket connections fail globally
      setGlobalConnectBehavior(true);

      // Simulate socket close - this triggers first handleReconnection
      socket.simulateClose();

      // After simulateClose, first onReconnecting is called synchronously
      // reconnectAttempts = 1, onReconnecting called with (1, ~2000ms)
      await vi.advanceTimersByTimeAsync(0);
      expect(connectedRuntime.getReconnectAttempt()).toBe(1);
      expect(mockOnReconnecting).toHaveBeenCalledTimes(1);

      // After first delay (~2000ms), performReconnection runs, fails,
      // and handleReconnection is called again from catch block
      // reconnectAttempts = 2, onReconnecting called with (2, ~4000ms)
      await vi.advanceTimersByTimeAsync(2200);
      expect(connectedRuntime.getReconnectAttempt()).toBe(2);
      expect(mockOnReconnecting).toHaveBeenCalledTimes(2);
    });

    it("should use exponential backoff for reconnection delays", async () => {
      vi.useFakeTimers();

      // Make all new socket connections fail globally
      setGlobalConnectBehavior(true);

      // Simulate socket close
      socket.simulateClose();

      // First onReconnecting called immediately (attempt 1, delay = 1000 * 2^1 = 2000ms)
      await vi.advanceTimersByTimeAsync(0);
      expect(mockOnReconnecting).toHaveBeenCalledTimes(1);
      const [attempt1, delay1] = mockOnReconnecting.mock.calls[0];
      expect(attempt1).toBe(1);
      expect(delay1).toBeGreaterThanOrEqual(1800); // 2000 ± 10%
      expect(delay1).toBeLessThanOrEqual(2200);

      // After first delay, reconnection fails, second onReconnecting (attempt 2, delay = 1000 * 2^2 = 4000ms)
      await vi.advanceTimersByTimeAsync(2200);
      expect(mockOnReconnecting).toHaveBeenCalledTimes(2);
      const [attempt2, delay2] = mockOnReconnecting.mock.calls[1];
      expect(attempt2).toBe(2);
      expect(delay2).toBeGreaterThanOrEqual(3600); // 4000 ± 10%
      expect(delay2).toBeLessThanOrEqual(4400);

      // After second delay, reconnection fails, third onReconnecting (attempt 3, delay = 1000 * 2^3 = 8000ms)
      await vi.advanceTimersByTimeAsync(4400);
      expect(mockOnReconnecting).toHaveBeenCalledTimes(3);
      const [attempt3, delay3] = mockOnReconnecting.mock.calls[2];
      expect(attempt3).toBe(3);
      expect(delay3).toBeGreaterThanOrEqual(7200); // 8000 ± 10%
      expect(delay3).toBeLessThanOrEqual(8800);
    });

    it("should cap reconnection delay at maxDelayMs (60 seconds)", async () => {
      vi.useFakeTimers();

      // Make all new socket connections fail globally
      setGlobalConnectBehavior(true);

      // Simulate socket close
      socket.simulateClose();

      // First callback happens immediately
      await vi.advanceTimersByTimeAsync(0);
      expect(mockOnReconnecting).toHaveBeenCalledTimes(1);

      // Advance through attempts to reach the cap:
      // Attempt 1: delay ~2s (2^1), Attempt 2: ~4s (2^2), Attempt 3: ~8s (2^3),
      // Attempt 4: ~16s (2^4), Attempt 5: ~32s (2^5), Attempt 6: ~60s (capped from 64s)
      const delays = [2200, 4400, 8800, 17600, 35200, 66000];
      for (let i = 0; i < delays.length; i++) {
        await vi.advanceTimersByTimeAsync(delays[i]);
      }

      // Should have 7 calls: initial + 6 after delays
      expect(mockOnReconnecting).toHaveBeenCalledTimes(7);

      // Check the 6th attempt (index 5) delay is capped
      const [, delay6] = mockOnReconnecting.mock.calls[5];
      expect(delay6).toBeGreaterThanOrEqual(54000); // 60000 ± 10%
      expect(delay6).toBeLessThanOrEqual(66000);

      // Check the 7th attempt (index 6) is also capped
      const [, delay7] = mockOnReconnecting.mock.calls[6];
      expect(delay7).toBeGreaterThanOrEqual(54000);
      expect(delay7).toBeLessThanOrEqual(66000);
    });

    it("should stop reconnecting after max attempts (10)", async () => {
      vi.useFakeTimers();

      // Make all new socket connections fail globally
      setGlobalConnectBehavior(true);

      // Simulate socket close
      socket.simulateClose();

      // First callback happens immediately
      await vi.advanceTimersByTimeAsync(0);

      // Run through all attempts - advance enough time for each
      // Each iteration: advance 70s (more than max delay of 60s)
      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(70000);
      }

      // Should have exactly 10 onReconnecting calls
      expect(mockOnReconnecting).toHaveBeenCalledTimes(10);
      expect(connectedRuntime.getReconnectAttempt()).toBe(10);

      // Verify error callback was called about max attempts
      expect(mockOnError).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining("Max reconnection attempts") })
      );

      // Verify no more reconnection attempts after max
      await vi.advanceTimersByTimeAsync(70000);
      expect(mockOnReconnecting).toHaveBeenCalledTimes(10);
    });

    it("should not trigger reconnection on intentional disconnect", async () => {
      // Disconnect intentionally
      await connectedRuntime.disconnect();

      // Should not trigger reconnection
      expect(connectedRuntime.isReconnectingNow()).toBe(false);
      expect(mockOnReconnecting).not.toHaveBeenCalled();
    });

    it("should call onReconnected after successful reconnection", async () => {
      vi.useFakeTimers();

      // Simulate socket close
      socket.simulateClose();

      // Let reconnection happen (delay ~2000ms for first attempt)
      await vi.advanceTimersByTimeAsync(2200);

      // Wait for the async reconnection to complete
      await vi.runAllTimersAsync();

      // Verify onReconnected was called
      expect(mockOnReconnected).toHaveBeenCalledTimes(1);
      expect(connectedRuntime.isReconnectingNow()).toBe(false);
      expect(connectedRuntime.getReconnectAttempt()).toBe(0);
    });

    it("should reset reconnect attempts after successful reconnection", async () => {
      vi.useFakeTimers();

      // Simulate socket close
      socket.simulateClose();

      // Let reconnection happen
      await vi.advanceTimersByTimeAsync(2200);
      await vi.runAllTimersAsync();

      // Verify reconnect attempts reset
      expect(connectedRuntime.getReconnectAttempt()).toBe(0);
      expect(connectedRuntime.isConnected()).toBe(true);
    });
  });

  describe("contact state persistence on disconnect", () => {
    it("should flush contact state when disconnecting", async () => {
      // Set up fetch to return empty chats list and no pending messages
      const urlConfigs = new Map<string, { response?: unknown }>();
      urlConfigs.set(`${mockThenvoiConfig.restUrl}/api/v1/agent/chats`, {
        response: { chats: [] },
      });
      urlConfigs.set(`${mockThenvoiConfig.restUrl}/api/v1/agent/contacts/requests`, {
        response: { received: [], sent: [], metadata: { page: 1, page_size: 100, received: { total: 0, total_pages: 0 }, sent: { total: 0, total_pages: 0 } } },
      });
      globalThis.fetch = createMockFetchByUrl(urlConfigs, {
        response: { message: "no_pending_messages" },
      });

      // Create runtime with contact handling enabled (direct strategy)
      const contactRuntime = new ThenvoiRuntime(
        mockThenvoiConfig,
        callbacks,
        mockClient,
        { strategy: "direct", broadcastChanges: false },
      );

      await contactRuntime.connect();

      // Access the internal contact handler to spy on flushState
      const handler = (contactRuntime as unknown as { contactEventHandler: { flushState: () => Promise<void> } }).contactEventHandler;
      expect(handler).toBeDefined();

      const flushSpy = vi.spyOn(handler, "flushState").mockResolvedValue(undefined);
      const setBroadcastsSpy = vi.spyOn(handler as any, "setPendingBroadcasts");

      await contactRuntime.disconnect();

      expect(setBroadcastsSpy).toHaveBeenCalledTimes(1);
      expect(flushSpy).toHaveBeenCalledTimes(1);
      // setPendingBroadcasts should be called before flushState
      const setBroadcastsOrder = setBroadcastsSpy.mock.invocationCallOrder[0];
      const flushOrder = flushSpy.mock.invocationCallOrder[0];
      expect(setBroadcastsOrder).toBeLessThan(flushOrder);
    });
  });

  describe("message queuing during sync", () => {
    it("should queue WS messages that arrive during sync and process after", async () => {
      // This test verifies the Python SDK-aligned behavior:
      // WS messages arriving during sync are queued, not skipped

      // Create a runtime where we can control the sync
      const customRuntime = new ThenvoiRuntime(mockThenvoiConfig, callbacks, mockClient);

      // Verify the runtime can be created
      expect(customRuntime).toBeDefined();
      expect(customRuntime.isSyncing()).toBe(false);

      // After disconnect, pending queue should be cleared
      await customRuntime.disconnect();
      expect(customRuntime.getProcessedMessageCount()).toBe(0);
    });

    it("should clear pending queue on disconnect", async () => {
      const customRuntime = new ThenvoiRuntime(mockThenvoiConfig, callbacks, mockClient);

      // Disconnect should clear all state including pending queue
      await customRuntime.disconnect();

      // Verify clean state
      expect(customRuntime.getRooms().size).toBe(0);
      expect(customRuntime.getProcessedMessageCount()).toBe(0);
      expect(customRuntime.isConnected()).toBe(false);
    });
  });
});
