/**
 * Unit tests for the contact_added auto-conversation handler.
 *
 * Tests the functionality that automatically starts a conversation
 * when a new contact is added.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { thenvoiChannel } from "../../src/channel.js";
import { ThenvoiClient } from "../../src/thenvoi-client.js";
import { ThenvoiRuntime } from "../../src/runtime.js";
import type { ContactEventConfig, ContactEvent } from "../../src/types.js";
import { mockAccountConfig } from "../fixtures/configs.js";
import {
  mockContactAddedPayload,
  mockAgentContactAddedPayload,
  mockContactRequestReceivedPayload,
  mockAgentMetadata,
  mockCreateChatroomResponse,
  mockAddParticipantResponse,
  mockSendMessageResponse,
} from "../fixtures/payloads.js";

// Mock the modules
vi.mock("../../src/thenvoi-client.js");
vi.mock("../../src/runtime.js");

describe("Contact Auto-Conversation Handler", () => {
  let mockClient: {
    createChat: ReturnType<typeof vi.fn>;
    addParticipant: ReturnType<typeof vi.fn>;
    getAgentMe: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
    respondContactRequest: ReturnType<typeof vi.fn>;
  };
  let capturedContactConfig: ContactEventConfig | undefined;
  let capturedCallbacks: unknown;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedContactConfig = undefined;
    capturedCallbacks = undefined;

    // Create mock client methods
    mockClient = {
      createChat: vi.fn().mockResolvedValue(mockCreateChatroomResponse),
      addParticipant: vi.fn().mockResolvedValue(mockAddParticipantResponse),
      getAgentMe: vi.fn().mockResolvedValue(mockAgentMetadata),
      sendMessage: vi.fn().mockResolvedValue(mockSendMessageResponse),
      respondContactRequest: vi.fn().mockResolvedValue({ success: true }),
    };

    // Mock ThenvoiClient constructor to return our mock client
    vi.mocked(ThenvoiClient).mockImplementation(() => mockClient as unknown as ThenvoiClient);

    // Mock ThenvoiRuntime to capture the contactConfig
    vi.mocked(ThenvoiRuntime).mockImplementation((config, callbacks, client, contactConfig) => {
      capturedContactConfig = contactConfig;
      capturedCallbacks = callbacks;
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
        isConnected: vi.fn().mockReturnValue(true),
        getRooms: vi.fn().mockReturnValue(new Map()),
      } as unknown as ThenvoiRuntime;
    });

    // Spy on console methods
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    // Stop the channel to clean up
    await thenvoiChannel.gateway?.stopAccount?.({ accountId: "test-account" } as never);
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  /**
   * Helper to start the channel and capture the contact event handler
   */
  async function startChannelAndGetHandler(): Promise<(event: ContactEvent) => Promise<void>> {
    const abortController = new AbortController();
    await thenvoiChannel.gateway!.startAccount!({
      cfg: mockAccountConfig,
      accountId: "test-account",
      account: mockAccountConfig,
      abortSignal: abortController.signal,
    });

    expect(capturedContactConfig).toBeDefined();
    expect(capturedContactConfig?.onEvent).toBeDefined();
    return capturedContactConfig!.onEvent!;
  }

  describe("contact_added event handling", () => {
    it("should create a chat room when a new contact is added", async () => {
      const handler = await startChannelAndGetHandler();

      const event: ContactEvent = {
        type: "contact_added",
        payload: mockContactAddedPayload,
      };

      await handler(event);

      expect(mockClient.createChat).toHaveBeenCalledTimes(1);
    });

    it("should add the new contact as a participant to the chat room", async () => {
      const handler = await startChannelAndGetHandler();

      const event: ContactEvent = {
        type: "contact_added",
        payload: mockContactAddedPayload,
      };

      await handler(event);

      expect(mockClient.addParticipant).toHaveBeenCalledWith(
        mockCreateChatroomResponse.id,
        mockContactAddedPayload.id,
        "member"
      );
    });

    it("should fetch agent info for the welcome message", async () => {
      const handler = await startChannelAndGetHandler();

      const event: ContactEvent = {
        type: "contact_added",
        payload: mockContactAddedPayload,
      };

      await handler(event);

      expect(mockClient.getAgentMe).toHaveBeenCalledTimes(1);
    });

    it("should send a personalized welcome message", async () => {
      const handler = await startChannelAndGetHandler();

      const event: ContactEvent = {
        type: "contact_added",
        payload: mockContactAddedPayload,
      };

      await handler(event);

      expect(mockClient.sendMessage).toHaveBeenCalledWith(
        mockCreateChatroomResponse.id,
        expect.stringContaining(`Hi ${mockContactAddedPayload.name}!`),
        [{ id: mockContactAddedPayload.id, name: mockContactAddedPayload.name }]
      );

      // Verify the message includes the agent's name
      const callArgs = mockClient.sendMessage.mock.calls[0];
      expect(callArgs[1]).toContain(mockAgentMetadata.name);
    });

    it("should work for Agent contacts as well as User contacts", async () => {
      const handler = await startChannelAndGetHandler();

      const event: ContactEvent = {
        type: "contact_added",
        payload: mockAgentContactAddedPayload,
      };

      await handler(event);

      expect(mockClient.createChat).toHaveBeenCalledTimes(1);
      expect(mockClient.addParticipant).toHaveBeenCalledWith(
        mockCreateChatroomResponse.id,
        mockAgentContactAddedPayload.id,
        "member"
      );
      expect(mockClient.sendMessage).toHaveBeenCalledWith(
        mockCreateChatroomResponse.id,
        expect.stringContaining(`Hi ${mockAgentContactAddedPayload.name}!`),
        [{ id: mockAgentContactAddedPayload.id, name: mockAgentContactAddedPayload.name }]
      );
    });

    it("should log progress messages during the conversation flow", async () => {
      const handler = await startChannelAndGetHandler();

      const event: ContactEvent = {
        type: "contact_added",
        payload: mockContactAddedPayload,
      };

      await handler(event);

      // Verify logging of key steps
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("New contact added")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Created chat room")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Added")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Sent welcome message")
      );
    });
  });

  describe("error handling", () => {
    it("should handle createChat failure gracefully", async () => {
      mockClient.createChat.mockRejectedValueOnce(new Error("Failed to create chat"));

      const handler = await startChannelAndGetHandler();

      const event: ContactEvent = {
        type: "contact_added",
        payload: mockContactAddedPayload,
      };

      // Should not throw
      await expect(handler(event)).resolves.toBeUndefined();

      // Should log the error
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to start conversation"),
        expect.any(Error)
      );

      // Should not continue with subsequent operations
      expect(mockClient.addParticipant).not.toHaveBeenCalled();
      expect(mockClient.sendMessage).not.toHaveBeenCalled();
    });

    it("should handle addParticipant failure gracefully", async () => {
      mockClient.addParticipant.mockRejectedValueOnce(new Error("Failed to add participant"));

      const handler = await startChannelAndGetHandler();

      const event: ContactEvent = {
        type: "contact_added",
        payload: mockContactAddedPayload,
      };

      await expect(handler(event)).resolves.toBeUndefined();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to start conversation"),
        expect.any(Error)
      );

      // createChat succeeded, but sendMessage should not be called
      expect(mockClient.createChat).toHaveBeenCalled();
      expect(mockClient.sendMessage).not.toHaveBeenCalled();
    });

    it("should handle getAgentMe failure gracefully", async () => {
      mockClient.getAgentMe.mockRejectedValueOnce(new Error("Failed to get agent info"));

      const handler = await startChannelAndGetHandler();

      const event: ContactEvent = {
        type: "contact_added",
        payload: mockContactAddedPayload,
      };

      await expect(handler(event)).resolves.toBeUndefined();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to start conversation"),
        expect.any(Error)
      );
    });

    it("should handle sendMessage failure gracefully", async () => {
      mockClient.sendMessage.mockRejectedValueOnce(new Error("Failed to send message"));

      const handler = await startChannelAndGetHandler();

      const event: ContactEvent = {
        type: "contact_added",
        payload: mockContactAddedPayload,
      };

      await expect(handler(event)).resolves.toBeUndefined();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to start conversation"),
        expect.any(Error)
      );

      // All operations before sendMessage should have been called
      expect(mockClient.createChat).toHaveBeenCalled();
      expect(mockClient.addParticipant).toHaveBeenCalled();
      expect(mockClient.getAgentMe).toHaveBeenCalled();
    });
  });

  describe("contact_request_received event handling", () => {
    it("should auto-approve contact requests", async () => {
      const handler = await startChannelAndGetHandler();

      const event: ContactEvent = {
        type: "contact_request_received",
        payload: mockContactRequestReceivedPayload,
      };

      await handler(event);

      expect(mockClient.respondContactRequest).toHaveBeenCalledWith(
        "approve",
        undefined,
        mockContactRequestReceivedPayload.id
      );
    });

    it("should log when auto-approving contact request", async () => {
      const handler = await startChannelAndGetHandler();

      const event: ContactEvent = {
        type: "contact_request_received",
        payload: mockContactRequestReceivedPayload,
      };

      await handler(event);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Auto-approving contact request")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("approved")
      );
    });

    it("should handle respondContactRequest failure gracefully", async () => {
      mockClient.respondContactRequest.mockRejectedValueOnce(new Error("Failed to respond"));

      const handler = await startChannelAndGetHandler();

      const event: ContactEvent = {
        type: "contact_request_received",
        payload: mockContactRequestReceivedPayload,
      };

      await expect(handler(event)).resolves.toBeUndefined();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to approve contact request"),
        expect.any(Error)
      );
    });
  });

  describe("event filtering", () => {
    it("should not process contact_request_updated events", async () => {
      const handler = await startChannelAndGetHandler();

      const event = {
        type: "contact_request_updated" as const,
        payload: {
          id: "request-001",
          status: "approved",
        },
      };

      await handler(event as ContactEvent);

      // None of the client methods should be called
      expect(mockClient.createChat).not.toHaveBeenCalled();
      expect(mockClient.addParticipant).not.toHaveBeenCalled();
      expect(mockClient.sendMessage).not.toHaveBeenCalled();
      expect(mockClient.respondContactRequest).not.toHaveBeenCalled();
    });

    it("should not process contact_removed events", async () => {
      const handler = await startChannelAndGetHandler();

      const event = {
        type: "contact_removed" as const,
        payload: {
          id: "contact-001",
        },
      };

      await handler(event as ContactEvent);

      // None of the client methods should be called
      expect(mockClient.createChat).not.toHaveBeenCalled();
      expect(mockClient.respondContactRequest).not.toHaveBeenCalled();
    });
  });

  describe("contact config setup", () => {
    it("should configure contact handling with callback strategy", async () => {
      await startChannelAndGetHandler();

      expect(capturedContactConfig?.strategy).toBe("callback");
    });

    it("should enable broadcast changes", async () => {
      await startChannelAndGetHandler();

      expect(capturedContactConfig?.broadcastChanges).toBe(true);
    });
  });
});
