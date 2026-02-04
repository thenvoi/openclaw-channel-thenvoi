/**
 * Thenvoi REST API client.
 *
 * Handles all HTTP requests to the Thenvoi platform.
 * API paths and auth based on thenvoi-client-rest Python SDK.
 */

import type {
  AddParticipantResponse,
  AgentMetadata,
  CreateChatroomResponse,
  EventMessageType,
  EventMetadata,
  LookupPeersResponse,
  MentionRequest,
  NextMessageResponse,
  NoMessageResponse,
  Participant,
  SendEventResponse,
  SendMessageResponse,
  ThenvoiConfig,
} from "./types.js";
import { ThenvoiAuthError, ThenvoiError } from "./types.js";

export class ThenvoiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: ThenvoiConfig) {
    this.baseUrl = config.restUrl.replace(/\/$/, "");
    this.apiKey = config.apiKey;
  }

  // ===========================================================================
  // Agent API
  // ===========================================================================

  /**
   * Get the current agent's metadata.
   */
  async getAgentMe(): Promise<AgentMetadata> {
    const response = await this.request<{ data: AgentMetadata }>("GET", "/api/v1/agent/me");
    return response.data;
  }

  // ===========================================================================
  // Messages API
  // ===========================================================================

  /**
   * Send a message to a chat room.
   *
   * @param chatId - The chat to send the message to
   * @param content - The message content
   * @param mentions - List of participants to mention (required, at least 1)
   */
  async sendMessage(
    chatId: string,
    content: string,
    mentions: MentionRequest[],
  ): Promise<SendMessageResponse> {
    const message: { content: string; mentions: MentionRequest[] } = {
      content,
      mentions,
    };

    const response = await this.request<{ data: SendMessageResponse }>(
      "POST",
      `/api/v1/agent/chats/${chatId}/messages`,
      { message },
    );
    return response.data;
  }

  /**
   * Send an event to a chat room.
   *
   * Event types and their UI indicators:
   * - "thought": Agent's reasoning process (thinking indicator)
   * - "error": Error or problem report (error indicator)
   * - "task": Progress or status update (progress indicator)
   * - "tool_call": Tool invocation with args (tool execution indicator)
   * - "tool_result": Tool execution result (tool completion indicator)
   *
   * @param chatId - The chat to send the event to
   * @param content - The event content (human-readable description)
   * @param messageType - Type of event
   * @param metadata - Optional structured data (e.g., tool_call_id, name, args for tool events)
   */
  async sendEvent(
    chatId: string,
    content: string,
    messageType: EventMessageType,
    metadata?: EventMetadata,
  ): Promise<SendEventResponse> {
    const event: {
      content: string;
      message_type: EventMessageType;
      metadata?: EventMetadata;
    } = {
      content,
      message_type: messageType,
    };

    // Only include metadata if provided
    if (metadata !== undefined) {
      event.metadata = metadata;
    }

    const response = await this.request<{ data: SendEventResponse }>(
      "POST",
      `/api/v1/agent/chats/${chatId}/events`,
      { event },
    );
    return response.data;
  }

  /**
   * Mark a message as processing.
   */
  async markMessageProcessing(chatId: string, messageId: string): Promise<void> {
    await this.request(
      "POST",
      `/api/v1/agent/chats/${chatId}/messages/${messageId}/processing`,
    );
  }

  /**
   * Mark a message as processed.
   */
  async markMessageProcessed(chatId: string, messageId: string): Promise<void> {
    await this.request(
      "POST",
      `/api/v1/agent/chats/${chatId}/messages/${messageId}/processed`,
    );
  }

  /**
   * Mark a message as failed.
   */
  async markMessageFailed(
    chatId: string,
    messageId: string,
    error: string,
  ): Promise<void> {
    await this.request(
      "POST",
      `/api/v1/agent/chats/${chatId}/messages/${messageId}/failed`,
      { error },
    );
  }

  /**
   * Get the next unprocessed message from the backlog.
   * Used during message recovery/synchronization.
   *
   * @param chatId - Optional chat ID to get messages from a specific chat.
   *                 If not provided, gets the next message from any chat.
   * @returns The next pending message, or null if no messages available
   */
  async getNextMessage(chatId?: string): Promise<NextMessageResponse | null> {
    try {
      const path = chatId
        ? `/api/v1/agent/chats/${chatId}/next`
        : `/api/v1/agent/messages/next`;

      const response = await this.request<{ data: NextMessageResponse | null } | NoMessageResponse>(
        "GET",
        path,
      );

      console.log(`[thenvoi] getNextMessage response:`, JSON.stringify(response, null, 2));

      // Check if response indicates no messages
      if ("message" in response && response.message === "no_pending_messages") {
        return null;
      }

      // Handle wrapped response { data: ... }
      if ("data" in response) {
        if (response.data === null) {
          return null;
        }
        return response.data;
      }

      // Handle direct response (unlikely but just in case)
      if ("id" in response && response.id) {
        return response as unknown as NextMessageResponse;
      }

      return null;
    } catch (error) {
      // Handle 404 or 204 as "no messages" (some APIs return these for empty queue)
      if (error instanceof ThenvoiError && (error.statusCode === 404 || error.statusCode === 204)) {
        return null;
      }
      throw error;
    }
  }

  // ===========================================================================
  // Chats API
  // ===========================================================================

  /**
   * List agent's chats.
   */
  async listChats(): Promise<{ chats: Array<{ id: string; title: string }> }> {
    return this.request("GET", "/api/v1/agent/chats");
  }

  /**
   * Create a new chat room.
   */
  async createChat(taskId?: string): Promise<CreateChatroomResponse> {
    const request: { chat: { task_id?: string } } = { chat: {} };
    if (taskId) {
      request.chat.task_id = taskId;
    }

    const response = await this.request<{ data: CreateChatroomResponse }>(
      "POST",
      "/api/v1/agent/chats",
      request,
    );
    return response.data;
  }

  // ===========================================================================
  // Participants API
  // ===========================================================================

  /**
   * Add a participant to a chat.
   */
  async addParticipant(
    chatId: string,
    participantId: string,
    role: "owner" | "admin" | "member" = "member",
  ): Promise<AddParticipantResponse> {
    const request = {
      participant: {
        participant_id: participantId,
        role,
      },
    };

    return this.request<AddParticipantResponse>(
      "POST",
      `/api/v1/agent/chats/${chatId}/participants`,
      request,
    );
  }

  /**
   * Remove a participant from a chat.
   */
  async removeParticipant(chatId: string, participantId: string): Promise<void> {
    await this.request(
      "DELETE",
      `/api/v1/agent/chats/${chatId}/participants/${encodeURIComponent(participantId)}`,
    );
  }

  /**
   * Get all participants in a chat.
   */
  async getParticipants(chatId: string): Promise<Participant[]> {
    const response = await this.request<{ data: Participant[] }>(
      "GET",
      `/api/v1/agent/chats/${chatId}/participants`,
    );
    return response.data;
  }

  // ===========================================================================
  // Peers API
  // ===========================================================================

  /**
   * Lookup available peers (agents and users) on the platform.
   */
  async lookupPeers(
    page: number = 1,
    pageSize: number = 50,
  ): Promise<LookupPeersResponse> {
    const params = new URLSearchParams({
      page: page.toString(),
      page_size: pageSize.toString(),
    });

    const response = await this.request<{ data: Array<unknown>; metadata: unknown }>(
      "GET",
      `/api/v1/agent/peers?${params}`,
    );

    // Transform response to match our interface
    return {
      peers: response.data as LookupPeersResponse["peers"],
      page,
      page_size: pageSize,
      total_count: 0, // metadata may have this
      has_more: false,
    };
  }

  // ===========================================================================
  // HTTP Request Helper
  // ===========================================================================

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      "X-API-Key": this.apiKey,
      "Content-Type": "application/json",
    };

    const options: RequestInit = {
      method,
      headers,
    };

    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      if (response.status === 401) {
        throw new ThenvoiAuthError("Invalid API key");
      }

      const errorBody = await response.text();
      throw new ThenvoiError(
        `HTTP ${response.status}: ${errorBody}`,
        "HTTP_ERROR",
        response.status,
      );
    }

    // Handle empty responses (204 No Content)
    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }
}
