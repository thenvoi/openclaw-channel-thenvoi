/**
 * Unit tests for contact event configuration in the channel plugin.
 *
 * Verifies that the channel uses hub_room strategy (LLM-based decisions)
 * instead of auto-approving contact requests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { thenvoiChannel } from "../../src/channel.js";
import { ThenvoiClient } from "../../src/thenvoi-client.js";
import { ThenvoiRuntime } from "../../src/runtime.js";
import type { ContactEventConfig } from "../../src/types.js";
import { mockAccountConfig } from "../fixtures/configs.js";

// Mock the modules
vi.mock("../../src/thenvoi-client.js");
vi.mock("../../src/runtime.js");

describe("Contact Event Configuration", () => {
  let capturedContactConfig: ContactEventConfig | undefined;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedContactConfig = undefined;

    // Mock ThenvoiClient constructor
    vi.mocked(ThenvoiClient).mockImplementation(
      () =>
        ({
          respondContactRequest: vi.fn(),
        }) as unknown as ThenvoiClient,
    );

    // Mock ThenvoiRuntime to capture the contactConfig
    vi.mocked(ThenvoiRuntime).mockImplementation(
      (_config, _callbacks, _client, contactConfig) => {
        capturedContactConfig = contactConfig;
        return {
          connect: vi.fn().mockResolvedValue(undefined),
          disconnect: vi.fn().mockResolvedValue(undefined),
          isConnected: vi.fn().mockReturnValue(true),
          getRooms: vi.fn().mockReturnValue(new Map()),
        } as unknown as ThenvoiRuntime;
      },
    );

    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    await thenvoiChannel.gateway?.stopAccount?.({
      accountId: "test-account",
    } as never);
    consoleLogSpy.mockRestore();
  });

  async function startChannel(): Promise<void> {
    const abortController = new AbortController();
    await thenvoiChannel.gateway!.startAccount!({
      cfg: mockAccountConfig,
      accountId: "test-account",
      account: mockAccountConfig,
      abortSignal: abortController.signal,
    });
  }

  describe("default contact config", () => {
    it("should use hub_room strategy by default", async () => {
      await startChannel();

      expect(capturedContactConfig).toBeDefined();
      expect(capturedContactConfig?.strategy).toBe("hub_room");
    });

    it("should not set an onEvent callback", async () => {
      await startChannel();

      expect(capturedContactConfig?.onEvent).toBeUndefined();
    });

    it("should enable broadcast changes", async () => {
      await startChannel();

      expect(capturedContactConfig?.broadcastChanges).toBe(true);
    });
  });

  describe("account config override", () => {
    it("should use account-level contactConfig when provided", async () => {
      const customConfig: ContactEventConfig = {
        strategy: "disabled",
        broadcastChanges: false,
      };

      const abortController = new AbortController();
      await thenvoiChannel.gateway!.startAccount!({
        cfg: { ...mockAccountConfig, contactConfig: customConfig },
        accountId: "test-account",
        account: { ...mockAccountConfig, contactConfig: customConfig },
        abortSignal: abortController.signal,
      });

      expect(capturedContactConfig).toBeDefined();
      expect(capturedContactConfig?.strategy).toBe("disabled");
      expect(capturedContactConfig?.broadcastChanges).toBe(false);
    });

    it("should support callback strategy via account config", async () => {
      const onEvent = vi.fn();
      const customConfig: ContactEventConfig = {
        strategy: "callback",
        onEvent,
        broadcastChanges: true,
      };

      const abortController = new AbortController();
      await thenvoiChannel.gateway!.startAccount!({
        cfg: { ...mockAccountConfig, contactConfig: customConfig },
        accountId: "test-account",
        account: { ...mockAccountConfig, contactConfig: customConfig },
        abortSignal: abortController.signal,
      });

      expect(capturedContactConfig?.strategy).toBe("callback");
      expect(capturedContactConfig?.onEvent).toBe(onEvent);
    });
  });
});
