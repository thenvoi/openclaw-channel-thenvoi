/**
 * Thenvoi REST API client.
 *
 * This wrapper keeps the plugin's existing request/response contract stable while
 * consuming the published npm packages for Thenvoi dependencies.
 */

import { normalizePaginationMetadata } from "@thenvoi/sdk/rest";

import {
  ThenvoiAuthError,
  ThenvoiError,
  ThenvoiRateLimitError,
  type AddContactResponse,
  type AddParticipantResponse,
  type AgentMetadata,
  type ContactRequestAction,
  type CreateChatroomResponse,
  type EventMessageType,
  type EventMetadata,
  type ListContactRequestsResponse,
  type ListContactsResponse,
  type ListMemoriesResponse,
  type LookupPeersResponse,
  type MemoryOperationResult,
  type MemoryRecord,
  type MentionRequest,
  type NextMessageResponse,
  type Participant,
  type RemoveContactResponse,
  type RespondContactRequestResponse,
  type SendEventResponse,
  type SendMessageResponse,
  type StoreMemoryParams,
  type ThenvoiConfig,
} from "./types.js";

type MetadataRecord = Record<string, unknown>;

function asRecord(value: unknown): MetadataRecord | null {
  return typeof value === "object" && value !== null ? value as MetadataRecord : null;
}

function unwrapData<T>(value: unknown): T {
  const record = asRecord(value);
  if (record && "data" in record) {
    return record.data as T;
  }

  return value as T;
}

function toPluginPaginationMetadata(
  value: unknown,
  defaults: { page: number; pageSize: number },
): {
  page: number;
  page_size: number;
  total_count: number;
  total_pages: number;
} {
  const metadata = normalizePaginationMetadata(
    value as Record<string, unknown> | undefined,
    { mode: "lossy" },
  );
  const record = asRecord(metadata);

  const page = typeof metadata.page === "number" ? metadata.page : defaults.page;
  const pageSize = typeof record?.pageSize === "number"
    ? record.pageSize
    : typeof record?.page_size === "number"
      ? record.page_size
      : defaults.pageSize;
  const totalCount = typeof record?.totalCount === "number"
    ? record.totalCount
    : typeof record?.total_count === "number"
      ? record.total_count
      : 0;
  const totalPages = typeof record?.totalPages === "number"
    ? record.totalPages
    : typeof record?.total_pages === "number"
      ? record.total_pages
      : 0;

  return {
    page,
    page_size: pageSize,
    total_count: totalCount,
    total_pages: totalPages,
  };
}

export class ThenvoiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: ThenvoiConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.restUrl.replace(/\/$/, "");
  }

  async getAgentMe(): Promise<AgentMetadata> {
    const response = await this.request<AgentMetadata>("GET", "/api/v1/agent/me");
    const agent = unwrapData<AgentMetadata>(response);

    return {
      ...agent,
      status: agent.status === "online" ? "active" : agent.status,
    };
  }

  async sendMessage(
    chatId: string,
    content: string,
    mentions: MentionRequest[],
  ): Promise<SendMessageResponse> {
    const response = await this.request<SendMessageResponse>(
      "POST",
      `/api/v1/agent/chats/${chatId}/messages`,
      {
        message: {
          content,
          mentions,
        },
      },
    );
    const message = unwrapData<Partial<SendMessageResponse> & { id: string }>(response);

    return {
      id: message.id,
      chat_room_id: message.chat_room_id ?? chatId,
      recipients: message.recipients ?? mentions,
      success: message.success ?? true,
    };
  }

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

    if (metadata !== undefined) {
      event.metadata = metadata;
    }

    const response = await this.request<SendEventResponse>(
      "POST",
      `/api/v1/agent/chats/${chatId}/events`,
      { event },
    );
    const eventResponse = unwrapData<Partial<SendEventResponse> & { id: string }>(response);

    return {
      id: eventResponse.id,
      chat_room_id: eventResponse.chat_room_id ?? chatId,
      message_type: eventResponse.message_type ?? messageType,
      success: eventResponse.success ?? true,
    };
  }

  async markMessageProcessing(chatId: string, messageId: string): Promise<void> {
    await this.request(
      "POST",
      `/api/v1/agent/chats/${chatId}/messages/${messageId}/processing`,
    );
  }

  async markMessageProcessed(chatId: string, messageId: string): Promise<void> {
    await this.request(
      "POST",
      `/api/v1/agent/chats/${chatId}/messages/${messageId}/processed`,
    );
  }

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

  async getNextMessage(chatId?: string): Promise<NextMessageResponse | null> {
    if (!chatId) {
      return null;
    }

    try {
      const response = await this.request<NextMessageResponse | { message: string }>(
        "GET",
        `/api/v1/agent/chats/${chatId}/messages/next`,
      );
      const payload = unwrapData<NextMessageResponse | { message: string } | null>(response);

      if (!payload) {
        return null;
      }

      if (asRecord(payload)?.message === "no_pending_messages") {
        return null;
      }

      return payload as NextMessageResponse;
    } catch (error) {
      if (error instanceof ThenvoiError && (error.statusCode === 404 || error.statusCode === 204)) {
        return null;
      }

      throw error;
    }
  }

  async listChats(): Promise<{ chats: Array<{ id: string; title: string }> }> {
    const response = await this.request<Array<{ id: string; title?: string }>>(
      "GET",
      "/api/v1/agent/chats",
    );
    const chats = unwrapData<Array<{ id: string; title?: string }>>(response);

    return {
      chats: chats.map((chat) => ({
        id: chat.id,
        title: chat.title ?? "Thenvoi Chat",
      })),
    };
  }

  async createChat(taskId?: string): Promise<CreateChatroomResponse> {
    const response = await this.request<CreateChatroomResponse>(
      "POST",
      "/api/v1/agent/chats",
      {
        chat: taskId ? { task_id: taskId } : {},
      },
    );
    const chat = unwrapData<Partial<CreateChatroomResponse> & { id: string }>(response);

    return {
      id: chat.id,
      inserted_at: chat.inserted_at ?? "",
      updated_at: chat.updated_at ?? "",
      ...(taskId ? { task_id: chat.task_id ?? taskId } : {}),
      ...(chat.title ? { title: chat.title } : {}),
    };
  }

  async addParticipant(
    chatId: string,
    participantId: string,
    role: "owner" | "admin" | "member" = "member",
  ): Promise<AddParticipantResponse> {
    await this.request(
      "POST",
      `/api/v1/agent/chats/${chatId}/participants`,
      {
        participant: {
          participant_id: participantId,
          role,
        },
      },
    );
    const participants = await this.getParticipants(chatId);
    const participant = participants.find((entry) => entry.id === participantId);

    if (!participant) {
      throw new ThenvoiError(
        `Participant ${participantId} not found after add`,
        "PARTICIPANT_NOT_FOUND",
      );
    }

    return {
      id: participant.id,
      name: participant.name,
      type: participant.type,
      role: participant.role,
    };
  }

  async removeParticipant(chatId: string, participantId: string): Promise<void> {
    await this.request(
      "DELETE",
      `/api/v1/agent/chats/${chatId}/participants/${encodeURIComponent(participantId)}`,
    );
  }

  async getParticipants(chatId: string): Promise<Participant[]> {
    const response = await this.request<Participant[]>(
      "GET",
      `/api/v1/agent/chats/${chatId}/participants`,
    );

    return unwrapData<Participant[]>(response);
  }

  async lookupPeers(
    page: number = 1,
    pageSize: number = 50,
  ): Promise<LookupPeersResponse> {
    const params = new URLSearchParams({
      not_in_chat: "",
      page: page.toString(),
      page_size: pageSize.toString(),
    });
    const response = await this.request<{
      data?: LookupPeersResponse["peers"];
      peers?: LookupPeersResponse["peers"];
      metadata?: Record<string, unknown>;
      total_count?: number;
      has_more?: boolean;
    }>(
      "GET",
      `/api/v1/agent/peers?${params}`,
    );
    const record = asRecord(response) ?? {};
    const peers = Array.isArray(record.data)
      ? record.data as LookupPeersResponse["peers"]
      : Array.isArray(record.peers)
        ? record.peers as LookupPeersResponse["peers"]
        : [];
    const metadata = toPluginPaginationMetadata(record.metadata, { page, pageSize });

    return {
      peers,
      page: metadata.page,
      page_size: metadata.page_size,
      total_count: typeof record.total_count === "number" ? record.total_count : metadata.total_count,
      has_more: typeof record.has_more === "boolean"
        ? record.has_more
        : metadata.total_pages > metadata.page,
    };
  }

  async listContacts(
    page: number = 1,
    pageSize: number = 50,
  ): Promise<ListContactsResponse> {
    const params = new URLSearchParams({
      page: page.toString(),
      page_size: pageSize.toString(),
    });
    const response = await this.request<{
      data?: ListContactsResponse["contacts"];
      contacts?: ListContactsResponse["contacts"];
      metadata?: Record<string, unknown>;
    }>(
      "GET",
      `/api/v1/agent/contacts?${params}`,
    );
    const record = asRecord(response) ?? {};

    return {
      contacts: Array.isArray(record.data)
        ? record.data as ListContactsResponse["contacts"]
        : Array.isArray(record.contacts)
          ? record.contacts as ListContactsResponse["contacts"]
          : [],
      metadata: toPluginPaginationMetadata(record.metadata, { page, pageSize }),
    };
  }

  async addContact(handle: string, message?: string): Promise<AddContactResponse> {
    const response = await this.request<AddContactResponse>(
      "POST",
      "/api/v1/agent/contacts/add",
      message ? { handle, message } : { handle },
    );

    return unwrapData<AddContactResponse>(response);
  }

  async removeContact(
    handle?: string,
    contactId?: string,
  ): Promise<RemoveContactResponse> {
    const response = await this.request<RemoveContactResponse>(
      "POST",
      "/api/v1/agent/contacts/remove",
      {
        ...(handle ? { handle } : {}),
        ...(contactId ? { contact_id: contactId } : {}),
      },
    );

    return unwrapData<RemoveContactResponse>(response);
  }

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
      data?: {
        received?: ListContactRequestsResponse["received"];
        sent?: ListContactRequestsResponse["sent"];
      };
      received?: ListContactRequestsResponse["received"];
      sent?: ListContactRequestsResponse["sent"];
      metadata?: Record<string, unknown>;
    }>(
      "GET",
      `/api/v1/agent/contacts/requests?${params}`,
    );
    const record = asRecord(response) ?? {};
    const payload = asRecord(record.data) ?? record;
    const metadata = asRecord(record.metadata) ?? {};

    return {
      received: Array.isArray(payload.received)
        ? payload.received as ListContactRequestsResponse["received"]
        : [],
      sent: Array.isArray(payload.sent)
        ? payload.sent as ListContactRequestsResponse["sent"]
        : [],
      metadata: {
        page: typeof metadata.page === "number" ? metadata.page : page,
        page_size: typeof metadata.page_size === "number" ? metadata.page_size : pageSize,
        received: asRecord(metadata.received) as { total: number; total_pages: number } ?? { total: 0, total_pages: 0 },
        sent: asRecord(metadata.sent) as { total: number; total_pages: number } ?? { total: 0, total_pages: 0 },
      },
    };
  }

  async respondContactRequest(
    action: ContactRequestAction,
    handle?: string,
    requestId?: string,
  ): Promise<RespondContactRequestResponse> {
    const response = await this.request<RespondContactRequestResponse>(
      "POST",
      "/api/v1/agent/contacts/requests/respond",
      {
        action,
        ...(handle ? { handle } : {}),
        ...(requestId ? { request_id: requestId } : {}),
      },
    );

    return unwrapData<RespondContactRequestResponse>(response);
  }

  async listMemories(
    params: {
      subject_id?: string;
      scope?: string;
      system?: string;
      type?: string;
      segment?: string;
      content_query?: string;
      page_size?: number;
      status?: string;
    } = {},
  ): Promise<ListMemoriesResponse> {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        searchParams.set(key, String(value));
      }
    }

    const suffix = searchParams.toString();
    const response = await this.request<{
      data?: MemoryRecord[];
      memories?: MemoryRecord[];
      metadata?: Record<string, unknown>;
    }>(
      "GET",
      `/api/v1/agent/memories${suffix.length > 0 ? `?${suffix}` : ""}`,
    );
    const record = asRecord(response) ?? {};

    return {
      memories: Array.isArray(record.data)
        ? record.data as MemoryRecord[]
        : Array.isArray(record.memories)
          ? record.memories as MemoryRecord[]
          : [],
      metadata: toPluginPaginationMetadata(record.metadata, {
        page: 1,
        pageSize: params.page_size ?? 50,
      }),
    };
  }

  async storeMemory(request: StoreMemoryParams): Promise<MemoryRecord> {
    const response = await this.request<MemoryRecord>(
      "POST",
      "/api/v1/agent/memories",
      { memory: request },
    );

    return unwrapData<MemoryRecord>(response);
  }

  async getMemory(memoryId: string): Promise<MemoryRecord> {
    const response = await this.request<MemoryRecord>(
      "GET",
      `/api/v1/agent/memories/${encodeURIComponent(memoryId)}`,
    );

    return unwrapData<MemoryRecord>(response);
  }

  async supersedeMemory(memoryId: string): Promise<MemoryOperationResult> {
    const response = await this.request<MemoryOperationResult>(
      "POST",
      `/api/v1/agent/memories/${encodeURIComponent(memoryId)}/supersede`,
    );

    return unwrapData<MemoryOperationResult>(response);
  }

  async archiveMemory(memoryId: string): Promise<MemoryOperationResult> {
    const response = await this.request<MemoryOperationResult>(
      "POST",
      `/api/v1/agent/memories/${encodeURIComponent(memoryId)}/archive`,
    );

    return unwrapData<MemoryOperationResult>(response);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "X-API-Key": this.apiKey,
        "Content-Type": "application/json",
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new ThenvoiAuthError("Invalid API key");
      }

      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        let retryAfterMs = 60_000;

        if (retryAfter) {
          const seconds = Number.parseInt(retryAfter, 10);
          if (!Number.isNaN(seconds)) {
            retryAfterMs = seconds * 1000;
          }
        }

        throw new ThenvoiRateLimitError(
          `Rate limited. Retry after ${Math.ceil(retryAfterMs / 1000)}s`,
          retryAfterMs,
        );
      }

      throw new ThenvoiError(
        `HTTP ${response.status}: ${await response.text()}`,
        "HTTP_ERROR",
        response.status,
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }
}
