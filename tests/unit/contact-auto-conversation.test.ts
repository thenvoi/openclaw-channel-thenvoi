/**
 * Unit tests for the contact event handling configuration.
 *
 * Tests that the channel configures DIRECT strategy so the LLM
 * decides whether to approve or reject contact requests.
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

describe("Contact Event Handling Config", () => {
  let capturedContactConfig: ContactEventConfig | undefined;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedContactConfig = undefined;

    // Create mock client methods
    const mockClient = {
      createChat: vi.fn().mockResolvedValue({ id: "room-001" }),
      addParticipant: vi.fn().mockResolvedValue({ success: true }),
      getAgentMe: vi.fn().mockResolvedValue({ name: "Test Agent" }),
      sendMessage: vi.fn().mockResolvedValue({ success: true }),
      respondContactRequest: vi.fn().mockResolvedValue({ success: true }),
      lookupPeers: vi.fn().mockResolvedValue({ peers: [], page: 1, page_size: 100, total_count: 0, has_more: false }),
    };

    // Mock ThenvoiClient constructor to return our mock client
    vi.mocked(ThenvoiClient).mockImplementation(() => mockClient as unknown as ThenvoiClient);

    // Mock ThenvoiRuntime to capture the contactConfig
    vi.mocked(ThenvoiRuntime).mockImplementation((config, callbacks, client, contactConfig) => {
      capturedContactConfig = contactConfig;
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
        isConnected: vi.fn().mockReturnValue(true),
        getRooms: vi.fn().mockReturnValue(new Map()),
      } as unknown as ThenvoiRuntime;
    });

    // Spy on console methods
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    await thenvoiChannel.gateway?.stopAccount?.({ accountId: "test-account" } as never);
    consoleLogSpy.mockRestore();
  });

  /**
   * Helper to start the channel and capture the contact config.
   */
  async function startChannelAndGetConfig(): Promise<ContactEventConfig> {
    const abortController = new AbortController();
    await thenvoiChannel.gateway!.startAccount!({
      cfg: mockAccountConfig,
      accountId: "test-account",
      account: mockAccountConfig,
      abortSignal: abortController.signal,
    });

    expect(capturedContactConfig).toBeDefined();
    return capturedContactConfig!;
  }

  describe("contact config setup", () => {
    it("should configure contact handling with direct strategy", async () => {
      const config = await startChannelAndGetConfig();

      expect(config.strategy).toBe("direct");
    });

    it("should enable broadcast changes", async () => {
      const config = await startChannelAndGetConfig();

      expect(config.broadcastChanges).toBe(true);
    });

    it("should not set an onEvent callback", async () => {
      const config = await startChannelAndGetConfig();

      expect(config.onEvent).toBeUndefined();
    });
  });
});
