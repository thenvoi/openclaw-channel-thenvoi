/**
 * Thenvoi REST API client.
 *
 * Handles all HTTP requests to the Thenvoi platform.
 * API paths and auth based on thenvoi-client-rest Python SDK.
 */

import type {
  AddContactResponse,
  AddParticipantResponse,
  AgentMetadata,
  ArchiveMemoryResponse,
  ContactRequestAction,
  CreateChatroomResponse,
  EventMessageType,
  EventMetadata,
  GetMemoryResponse,
  ListContactRequestsResponse,
  ListContactsResponse,
  ListMemoriesResponse,
  LookupPeersResponse,
  MentionRequest,
  MemoryScope,
  MemorySegment,
  MemoryStatus,
  MemorySystem,
  MemoryType,
  NextMessageResponse,
  NoMessageResponse,
  Participant,
  RemoveContactResponse,
  RespondContactRequestResponse,
  SendEventResponse,
  SendMessageResponse,
  StoreMemoryResponse,
  SupersedeMemoryResponse,
  ThenvoiConfig,
} from "./types.js";
import { ThenvoiAuthError, ThenvoiError, ThenvoiRateLimitError } from "./types.js";

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
        ? `/api/v1/agent/chats/${chatId}/messages/next`
        : `/api/v1/agent/messages/next`;

      const response = await this.request<{ data: NextMessageResponse | null } | NoMessageResponse>(
        "GET",
        path,
      );

      console.log(`[thenvoi] getNextMessage response:`, JSON.stringify(response, null, 2));

      // Handle empty response (204 No Content or empty body)
      if (response === undefined || response === null) {
        return null;
      }

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
  // Contacts API
  // ===========================================================================

  /**
   * List agent's contacts with pagination.
   */
  async listContacts(
    page: number = 1,
    pageSize: number = 50,
  ): Promise<ListContactsResponse> {
    const params = new URLSearchParams({
      page: page.toString(),
      page_size: pageSize.toString(),
    });

    const response = await this.request<{
      data: ListContactsResponse["contacts"];
      metadata: ListContactsResponse["metadata"];
    }>("GET", `/api/v1/agent/contacts?${params}`);

    return {
      contacts: response.data || [],
      metadata: response.metadata || {
        page,
        page_size: pageSize,
        total_count: 0,
        total_pages: 0,
      },
    };
  }

  /**
   * Send a contact request to add someone as a contact.
   *
   * @param handle - Handle of user/agent to add (e.g., '@john' or '@john/agent-name')
   * @param message - Optional message with the request
   * @returns Status is 'pending' when request created, 'approved' when auto-accepted
   */
  async addContact(
    handle: string,
    message?: string,
  ): Promise<AddContactResponse> {
    const body: { handle: string; message?: string } = { handle };
    if (message !== undefined) {
      body.message = message;
    }

    const response = await this.request<{ data: AddContactResponse }>(
      "POST",
      "/api/v1/agent/contacts/add",
      body,
    );
    return response.data;
  }

  /**
   * Remove an existing contact by handle or ID.
   *
   * @param handle - Contact's handle (optional if contact_id provided)
   * @param contactId - Contact record ID (optional if handle provided)
   */
  async removeContact(
    handle?: string,
    contactId?: string,
  ): Promise<RemoveContactResponse> {
    const body: { handle?: string; contact_id?: string } = {};
    if (handle) body.handle = handle;
    if (contactId) body.contact_id = contactId;

    const response = await this.request<{ data: RemoveContactResponse }>(
      "POST",
      "/api/v1/agent/contacts/remove",
      body,
    );
    return response.data;
  }

  /**
   * List both received and sent contact requests.
   *
   * @param page - Page number (default 1)
   * @param pageSize - Items per page per direction (default 50, max 100)
   * @param sentStatus - Filter sent requests by status (default 'pending')
   */
  async listContactRequests(
    page: number = 1,
    pageSize: number = 50,
    sentStatus: "pending" | "approved" | "rejected" | "cancelled" | "all" = "pending",
  ): Promise<ListContactRequestsResponse> {
    const params = new URLSearchParams({
      page: page.toString(),
      page_size: pageSize.toString(),
      sent_status: sentStatus,
    });

    const response = await this.request<{
      data: { received: ListContactRequestsResponse["received"]; sent: ListContactRequestsResponse["sent"] };
      metadata: ListContactRequestsResponse["metadata"];
    }>("GET", `/api/v1/agent/contacts/requests?${params}`);

    return {
      received: response.data?.received || [],
      sent: response.data?.sent || [],
      metadata: response.metadata || {
        page,
        page_size: pageSize,
        received: { total: 0, total_pages: 0 },
        sent: { total: 0, total_pages: 0 },
      },
    };
  }

  /**
   * Respond to a contact request (approve, reject, or cancel).
   *
   * @param action - Action to take: 'approve'/'reject' for received, 'cancel' for sent
   * @param handle - Other party's handle (optional if request_id provided)
   * @param requestId - Request ID (optional if handle provided)
   */
  async respondContactRequest(
    action: ContactRequestAction,
    handle?: string,
    requestId?: string,
  ): Promise<RespondContactRequestResponse> {
    const body: { action: ContactRequestAction; handle?: string; request_id?: string } = { action };
    if (handle) body.handle = handle;
    if (requestId) body.request_id = requestId;

    const response = await this.request<{ data: RespondContactRequestResponse }>(
      "POST",
      "/api/v1/agent/contacts/requests/respond",
      body,
    );
    return response.data;
  }

  // ===========================================================================
  // Memories API
  // ===========================================================================

  /**
   * List memories accessible to the agent.
   */
  async listMemories(options: {
    subjectId?: string;
    scope?: MemoryScope | "all";
    system?: MemorySystem;
    type?: MemoryType;
    segment?: MemorySegment;
    contentQuery?: string;
    pageSize?: number;
    status?: MemoryStatus | "all";
  } = {}): Promise<ListMemoriesResponse> {
    const params = new URLSearchParams();
    if (options.subjectId) params.set("subject_id", options.subjectId);
    if (options.scope) params.set("scope", options.scope);
    if (options.system) params.set("system", options.system);
    if (options.type) params.set("type", options.type);
    if (options.segment) params.set("segment", options.segment);
    if (options.contentQuery) params.set("content_query", options.contentQuery);
    if (options.pageSize) params.set("page_size", options.pageSize.toString());
    if (options.status) params.set("status", options.status);

    const response = await this.request<{
      data: ListMemoriesResponse["memories"];
      meta: ListMemoriesResponse["metadata"];
    }>("GET", `/api/v1/agent/memories?${params}`);

    return {
      memories: response.data || [],
      metadata: response.meta || {
        page_size: options.pageSize || 50,
        total_count: 0,
      },
    };
  }

  /**
   * Store a new memory entry.
   */
  async storeMemory(memory: {
    content: string;
    system: MemorySystem;
    type: MemoryType;
    segment: MemorySegment;
    thought: string;
    scope?: MemoryScope;
    subjectId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<StoreMemoryResponse> {
    const body: Record<string, unknown> = {
      memory: {
        content: memory.content,
        system: memory.system,
        type: memory.type,
        segment: memory.segment,
        thought: memory.thought,
        scope: memory.scope || "subject",
      },
    };

    if (memory.subjectId) {
      (body.memory as Record<string, unknown>).subject_id = memory.subjectId;
    }
    if (memory.metadata) {
      (body.memory as Record<string, unknown>).metadata = memory.metadata;
    }

    const response = await this.request<{ data: StoreMemoryResponse }>(
      "POST",
      "/api/v1/agent/memories",
      body,
    );
    return response.data;
  }

  /**
   * Retrieve a specific memory by ID.
   */
  async getMemory(memoryId: string): Promise<GetMemoryResponse> {
    const response = await this.request<{ data: GetMemoryResponse }>(
      "GET",
      `/api/v1/agent/memories/${encodeURIComponent(memoryId)}`,
    );
    return response.data;
  }

  /**
   * Mark a memory as superseded (soft delete).
   * Use when information is outdated or incorrect.
   */
  async supersedeMemory(memoryId: string): Promise<SupersedeMemoryResponse> {
    const response = await this.request<{ data: SupersedeMemoryResponse }>(
      "POST",
      `/api/v1/agent/memories/${encodeURIComponent(memoryId)}/supersede`,
    );
    return response.data;
  }

  /**
   * Archive a memory (hide but preserve).
   * Use when memory is valid but not currently needed.
   */
  async archiveMemory(memoryId: string): Promise<ArchiveMemoryResponse> {
    const response = await this.request<{ data: ArchiveMemoryResponse }>(
      "POST",
      `/api/v1/agent/memories/${encodeURIComponent(memoryId)}/archive`,
    );
    return response.data;
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

      if (response.status === 429) {
        // Parse Retry-After header (can be seconds or HTTP date)
        const retryAfter = response.headers.get("Retry-After");
        let retryAfterMs = 60_000; // Default: 60 seconds

        if (retryAfter) {
          const seconds = parseInt(retryAfter, 10);
          if (!isNaN(seconds)) {
            retryAfterMs = seconds * 1000;
          } else {
            // Try parsing as HTTP date
            const date = Date.parse(retryAfter);
            if (!isNaN(date)) {
              retryAfterMs = Math.max(0, date - Date.now());
            }
          }
        }

        console.log(`[thenvoi] Rate limited. Retry after ${retryAfterMs}ms`);
        throw new ThenvoiRateLimitError(
          `Rate limited. Retry after ${Math.ceil(retryAfterMs / 1000)}s`,
          retryAfterMs,
        );
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
