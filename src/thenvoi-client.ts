/**
 * Thenvoi REST API client.
 *
 * Handles all HTTP requests to the Thenvoi platform.
 */

import type {
  AddParticipantRequest,
  AddParticipantResponse,
  AgentMetadata,
  CreateChatroomRequest,
  CreateChatroomResponse,
  LookupPeersResponse,
  MessageType,
  NextMessageResponse,
  NoMessageResponse,
  Participant,
  SendMessageRequest,
  SendMessageResponse,
  ThenvoiConfig,
} from "./types.js";
import { ThenvoiAuthError, ThenvoiError } from "./types.js";

export class ThenvoiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly agentId: string;

  constructor(config: ThenvoiConfig) {
    this.baseUrl = config.restUrl.replace(/\/$/, "");
    this.apiKey = config.apiKey;
    this.agentId = config.agentId;
  }

  // ===========================================================================
  // Agent API
  // ===========================================================================

  /**
   * Get the current agent's metadata.
   */
  async getAgentMe(): Promise<AgentMetadata> {
    return this.request<AgentMetadata>("GET", "/api/agent/me");
  }

  // ===========================================================================
  // Messages API
  // ===========================================================================

  /**
   * Send a message to a chat room.
   *
   * @param roomId - The room to send the message to
   * @param content - The message content
   * @param mentions - Optional list of participant names to mention
   * @param messageType - Type of message (default: "text"). Use "thought", "error", or "task" for events.
   */
  async sendMessage(
    roomId: string,
    content: string,
    mentions?: string[],
    messageType: MessageType = "text",
  ): Promise<SendMessageResponse> {
    const request: SendMessageRequest = {
      room_id: roomId,
      content,
      message_type: messageType,
      mentions: mentions ?? [],
    };

    return this.request<SendMessageResponse>(
      "POST",
      "/api/agent/messages",
      request,
    );
  }

  /**
   * Mark a message as processing.
   */
  async markMessageProcessing(roomId: string, messageId: string): Promise<void> {
    await this.request(
      "POST",
      `/api/agent/chats/${roomId}/messages/${messageId}/processing`,
    );
  }

  /**
   * Mark a message as processed.
   */
  async markMessageProcessed(roomId: string, messageId: string): Promise<void> {
    await this.request(
      "POST",
      `/api/agent/chats/${roomId}/messages/${messageId}/processed`,
    );
  }

  /**
   * Mark a message as failed.
   */
  async markMessageFailed(
    roomId: string,
    messageId: string,
    error: string,
  ): Promise<void> {
    await this.request(
      "POST",
      `/api/agent/chats/${roomId}/messages/${messageId}/failed`,
      { error },
    );
  }

  /**
   * Get the next unprocessed message from the backlog.
   * Used during message recovery/synchronization.
   *
   * @returns The next pending message, or null if no messages available
   */
  async getNextMessage(): Promise<NextMessageResponse | null> {
    try {
      const response = await this.request<NextMessageResponse | NoMessageResponse>(
        "GET",
        "/api/agent/next",
      );

      // Check if response indicates no messages
      if ("message" in response && response.message === "no_pending_messages") {
        return null;
      }

      return response as NextMessageResponse;
    } catch (error) {
      // Handle 404 as "no messages" (some APIs return 404 for empty queue)
      if (error instanceof ThenvoiError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  // ===========================================================================
  // Participants API
  // ===========================================================================

  /**
   * Add a participant to a room.
   */
  async addParticipant(
    roomId: string,
    name: string,
    role: "owner" | "admin" | "member" = "member",
  ): Promise<AddParticipantResponse> {
    const request: AddParticipantRequest = { name, role };

    return this.request<AddParticipantResponse>(
      "POST",
      `/api/rooms/${roomId}/participants`,
      request,
    );
  }

  /**
   * Remove a participant from a room.
   */
  async removeParticipant(roomId: string, name: string): Promise<void> {
    await this.request(
      "DELETE",
      `/api/rooms/${roomId}/participants/${encodeURIComponent(name)}`,
    );
  }

  /**
   * Get all participants in a room.
   */
  async getParticipants(roomId: string): Promise<Participant[]> {
    const response = await this.request<{ participants: Participant[] }>(
      "GET",
      `/api/rooms/${roomId}/participants`,
    );
    return response.participants;
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

    return this.request<LookupPeersResponse>("GET", `/api/peers?${params}`);
  }

  // ===========================================================================
  // Rooms API
  // ===========================================================================

  /**
   * Create a new chat room.
   */
  async createChatroom(taskId?: string): Promise<CreateChatroomResponse> {
    const request: CreateChatroomRequest = {};
    if (taskId) {
      request.task_id = taskId;
    }

    return this.request<CreateChatroomResponse>("POST", "/api/rooms", request);
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
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      "X-Agent-ID": this.agentId,
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
        throw new ThenvoiAuthError("Invalid API key or agent ID");
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
