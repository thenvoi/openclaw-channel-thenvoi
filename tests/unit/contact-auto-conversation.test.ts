/**
 * Unit tests for the contact event handling configuration.
 *
 * Tests that the channel configures:
 * - CALLBACK strategy with auto-approve when no contactPolicy is set
 * - DIRECT strategy for LLM evaluation when contactPolicy is set
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { thenvoiChannel } from "../../src/channel.js";
import { ThenvoiClient } from "../../src/thenvoi-client.js";
import { ThenvoiRuntime } from "../../src/runtime.js";
import type { ContactEventConfig, ContactEvent } from "../../src/types.js";
import { mockAccountConfig } from "../fixtures/configs.js";

// Mock the modules
vi.mock("../../src/thenvoi-client.js");
vi.mock("../../src/runtime.js");

describe("Contact Event Handling Config", () => {
  let capturedContactConfig: ContactEventConfig | undefined;
  let mockClient: Record<string, ReturnType<typeof vi.fn>>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedContactConfig = undefined;

    // Create mock client methods
    mockClient = {
      createChat: vi.fn().mockResolvedValue({ id: "room-001" }),
      addParticipant: vi.fn().mockResolvedValue({ success: true }),
      getAgentMe: vi.fn().mockResolvedValue({ name: "Test Agent" }),
      sendMessage: vi.fn().mockResolvedValue({ success: true }),
      respondContactRequest: vi.fn().mockResolvedValue({ status: "approved" }),
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
  async function startChannelAndGetConfig(
    accountOverrides?: Record<string, unknown>,
  ): Promise<ContactEventConfig> {
    const account = { ...mockAccountConfig, ...accountOverrides };
    const abortController = new AbortController();
    await thenvoiChannel.gateway!.startAccount!({
      cfg: account,
      accountId: "test-account",
      account,
      abortSignal: abortController.signal,
    });

    expect(capturedContactConfig).toBeDefined();
    return capturedContactConfig!;
  }

  describe("without contactPolicy (auto-approve)", () => {
    it("should configure callback strategy", async () => {
      const config = await startChannelAndGetConfig();

      expect(config.strategy).toBe("callback");
    });

    it("should enable broadcast changes", async () => {
      const config = await startChannelAndGetConfig();

      expect(config.broadcastChanges).toBe(true);
    });

    it("should set an onEvent callback for auto-approve", async () => {
      const config = await startChannelAndGetConfig();

      expect(config.onEvent).toBeTypeOf("function");
    });

    it("should auto-approve contact_request_received events", async () => {
      const config = await startChannelAndGetConfig();

      const event: ContactEvent = {
        type: "contact_request_received",
        payload: {
          id: "req-001",
          from_handle: "alice/bot",
          from_name: "Alice Bot",
          message: "Hi there",
          status: "pending",
          inserted_at: new Date().toISOString(),
        },
      };

      await config.onEvent!(event);

      expect(mockClient.respondContactRequest).toHaveBeenCalledWith(
        "approve",
        undefined,
        "req-001",
      );
    });

    it("should not call respondContactRequest for non-request events", async () => {
      const config = await startChannelAndGetConfig();

      const event: ContactEvent = {
        type: "contact_added",
        payload: {
          id: "contact-001",
          handle: "alice/bot",
          name: "Alice Bot",
          type: "Agent",
        },
      };

      await config.onEvent!(event);

      expect(mockClient.respondContactRequest).not.toHaveBeenCalled();
    });
  });

  describe("with contactPolicy (LLM evaluation)", () => {
    const policy = "Only approve requests from agents in the @company namespace.";

    it("should configure direct strategy", async () => {
      const config = await startChannelAndGetConfig({ contactPolicy: policy });

      expect(config.strategy).toBe("direct");
    });

    it("should enable broadcast changes", async () => {
      const config = await startChannelAndGetConfig({ contactPolicy: policy });

      expect(config.broadcastChanges).toBe(true);
    });

    it("should not set an onEvent callback", async () => {
      const config = await startChannelAndGetConfig({ contactPolicy: policy });

      expect(config.onEvent).toBeUndefined();
    });
  });
});
