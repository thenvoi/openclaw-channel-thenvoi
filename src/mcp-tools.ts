/**
 * MCP tools exposed by the OpenClaw Thenvoi channel plugin.
 *
 * The tool contracts now come from the published SDK MCP builders. We compose:
 * - single-context registrations for tools that do not require a room
 * - room-scoped registrations for chat and participant operations
 */

import type { AdapterToolsProtocol } from "@thenvoi/sdk";
import { buildRoomScopedRegistrations, buildSingleContextRegistrations } from "@thenvoi/sdk/mcp";
import type { McpToolInputSchema, McpToolRegistration } from "@thenvoi/sdk/mcp";
import { AgentTools } from "@thenvoi/sdk/runtime";

import { getClient } from "./channel.js";
import type { ThenvoiClient } from "./thenvoi-client.js";

export interface McpTool extends McpToolRegistration {}

const ROOM_SCOPED_TOOL_NAMES = new Set<string>([
  "thenvoi_send_message",
  "thenvoi_send_event",
  "thenvoi_add_participant",
  "thenvoi_remove_participant",
  "thenvoi_get_participants",
]);

const EXPOSED_TOOL_NAMES = new Set<string>([
  "thenvoi_lookup_peers",
  "thenvoi_add_participant",
  "thenvoi_remove_participant",
  "thenvoi_get_participants",
  "thenvoi_create_chatroom",
  "thenvoi_send_event",
  "thenvoi_send_message",
  "thenvoi_list_contacts",
  "thenvoi_add_contact",
  "thenvoi_remove_contact",
  "thenvoi_list_contact_requests",
  "thenvoi_respond_contact_request",
  "thenvoi_list_memories",
  "thenvoi_store_memory",
  "thenvoi_get_memory",
  "thenvoi_supersede_memory",
  "thenvoi_archive_memory",
]);

let cachedClient: ReturnType<typeof getClient> | undefined;
let cachedSingleContextTools: AgentTools | undefined;
const roomScopedTools = new Map<string, AgentTools>();

type AgentToolsRestApi = ConstructorParameters<typeof AgentTools>[0]["rest"];

function buildAgentToolsRestApi(client: ThenvoiClient): AgentToolsRestApi {
  return {
    createChatMessage: async (
      chatId: string,
      message: {
        content: string;
        mentions?: Array<{ id: string; name: string }>;
      },
    ) => {
      const result = await client.sendMessage(chatId, message.content, message.mentions ?? []);
      return result as unknown as Record<string, unknown>;
    },
    createChatEvent: async (
      chatId: string,
      event: {
        content: string;
        messageType: string;
        metadata?: Record<string, unknown>;
      },
    ) => {
      const result = await client.sendEvent(
        chatId,
        event.content,
        event.messageType as never,
        event.metadata,
      );
      return result as unknown as Record<string, unknown>;
    },
    createChat: async (taskId?: string) => client.createChat(taskId),
    listChatParticipants: async (chatId: string) => client.getParticipants(chatId),
    addChatParticipant: async (
      chatId: string,
      participant: { participantId: string; role: string },
    ) => {
      const result = await client.addParticipant(
        chatId,
        participant.participantId,
        participant.role as never,
      );
      return result as unknown as Record<string, unknown>;
    },
    removeChatParticipant: async (chatId: string, participantId: string) => {
      await client.removeParticipant(chatId, participantId);
      return { ok: true };
    },
    listPeers: async (request: { page: number; pageSize: number }) => {
      const result = await client.lookupPeers(request.page, request.pageSize);
      return {
        data: result.peers,
        metadata: {
          page: result.page,
          page_size: result.page_size,
          total_count: result.total_count,
          total_pages: result.has_more ? result.page + 1 : result.page,
        },
      };
    },
    listContacts: async (request: { page?: number; pageSize?: number }) => {
      const result = await client.listContacts(request.page ?? 1, request.pageSize ?? 50);
      return {
        data: result.contacts,
        metadata: result.metadata,
      } as unknown as Awaited<ReturnType<NonNullable<AgentToolsRestApi["listContacts"]>>>;
    },
    addContact: async (request: { handle: string; message?: string }) => {
      const result = await client.addContact(request.handle, request.message);
      return result as unknown as Record<string, unknown>;
    },
    removeContact: async (request: { target: "handle" | "contactId"; handle?: string; contactId?: string }) => {
      const result = await client.removeContact(request.handle, request.contactId);
      return result as unknown as Record<string, unknown>;
    },
    listContactRequests: async (request: {
      page?: number;
      pageSize?: number;
      sentStatus?: "pending" | "approved" | "rejected" | "cancelled" | "all";
    }) => client.listContactRequests(
      request.page ?? 1,
      request.pageSize ?? 50,
      request.sentStatus ?? "pending",
    ) as unknown as Awaited<ReturnType<NonNullable<AgentToolsRestApi["listContactRequests"]>>>,
    respondContactRequest: async (request: {
      action: "approve" | "reject" | "cancel";
      target: "handle" | "requestId";
      handle?: string;
      requestId?: string;
    }) => {
      const result = await client.respondContactRequest(
        request.action,
        request.handle,
        request.requestId,
      );
      return result as unknown as Record<string, unknown>;
    },
    listMemories: async (request: Record<string, unknown>) => {
      const result = await client.listMemories(request);
      return {
        data: result.memories,
        metadata: result.metadata,
      } as unknown as Awaited<ReturnType<NonNullable<AgentToolsRestApi["listMemories"]>>>;
    },
    storeMemory: async (request: Parameters<ThenvoiClient["storeMemory"]>[0]) =>
      client.storeMemory(request),
    getMemory: async (memoryId: string) => client.getMemory(memoryId),
    supersedeMemory: async (memoryId: string) => {
      const result = await client.supersedeMemory(memoryId);
      return result as unknown as Record<string, unknown>;
    },
    archiveMemory: async (memoryId: string) => {
      const result = await client.archiveMemory(memoryId);
      return result as unknown as Record<string, unknown>;
    },
    getNextMessage: async (request: { chatId: string }) =>
      client.getNextMessage(request.chatId) as unknown as Awaited<
        ReturnType<NonNullable<AgentToolsRestApi["getNextMessage"]>>
      >,
  };
}

function createSdkAgentTools(roomId: string): AgentTools {
  const client = getClient();

  if (!client) {
    throw new Error("Thenvoi client not connected");
  }

  if (cachedClient !== client) {
    cachedClient = client;
    cachedSingleContextTools = undefined;
    roomScopedTools.clear();
  }

  if (roomId.length === 0) {
    if (!cachedSingleContextTools) {
      cachedSingleContextTools = new AgentTools({
        roomId,
        rest: buildAgentToolsRestApi(client),
      });
    }

    return cachedSingleContextTools;
  }

  const cachedRoomTools = roomScopedTools.get(roomId);
  if (cachedRoomTools) {
    return cachedRoomTools;
  }

  const tools = new AgentTools({
    roomId,
    rest: buildAgentToolsRestApi(client),
  });
  roomScopedTools.set(roomId, tools);

  return tools;
}

function getSingleContextTools(): AgentTools {
  return createSdkAgentTools("");
}

function createSingleContextToolsProxy(): AdapterToolsProtocol {
  return {
    capabilities: Object.freeze({
      peers: true,
      contacts: true,
      memory: true,
    }),
    sendMessage: async (content, mentions) =>
      getSingleContextTools().sendMessage(content, mentions),
    sendEvent: async (content, messageType, metadata) =>
      getSingleContextTools().sendEvent(content, messageType, metadata),
    addParticipant: async (name, role) =>
      getSingleContextTools().addParticipant(name, role),
    removeParticipant: async (name) => getSingleContextTools().removeParticipant(name),
    getParticipants: async () => getSingleContextTools().getParticipants(),
    createChatroom: async (taskId) => getSingleContextTools().createChatroom(taskId),
    lookupPeers: async (page, pageSize) =>
      getSingleContextTools().lookupPeers(page, pageSize),
    listContacts: async (request) => getSingleContextTools().listContacts(request),
    addContact: async (request) => getSingleContextTools().addContact(request),
    removeContact: async (request) => getSingleContextTools().removeContact(request),
    listContactRequests: async (request) =>
      getSingleContextTools().listContactRequests(request),
    respondContactRequest: async (request) =>
      getSingleContextTools().respondContactRequest(request),
    listMemories: async (request) => getSingleContextTools().listMemories(request),
    storeMemory: async (request) => getSingleContextTools().storeMemory(request),
    getMemory: async (memoryId) => getSingleContextTools().getMemory(memoryId),
    supersedeMemory: async (memoryId) =>
      getSingleContextTools().supersedeMemory(memoryId),
    archiveMemory: async (memoryId) => getSingleContextTools().archiveMemory(memoryId),
    getToolSchemas: (format, options) =>
      getSingleContextTools().getToolSchemas(format, options),
    getAnthropicToolSchemas: (options) =>
      getSingleContextTools().getAnthropicToolSchemas(options),
    getOpenAIToolSchemas: (options) =>
      getSingleContextTools().getOpenAIToolSchemas(options),
    executeToolCall: async (toolName, toolArgs) =>
      getSingleContextTools().executeToolCall(toolName, toolArgs),
  };
}

function filterRegistrations(
  registrations: McpToolRegistration[],
  predicate: (toolName: string) => boolean,
): McpToolRegistration[] {
  return registrations.filter(
    (registration) =>
      EXPOSED_TOOL_NAMES.has(registration.name) && predicate(registration.name),
  );
}

function buildMcpTools(): McpTool[] {
  const roomScoped = filterRegistrations(
    buildRoomScopedRegistrations((roomId) => createSdkAgentTools(roomId), {
      enableContactTools: true,
      enableMemoryTools: true,
    }),
    (toolName) => ROOM_SCOPED_TOOL_NAMES.has(toolName),
  );

  const singleContext = filterRegistrations(
    buildSingleContextRegistrations(createSingleContextToolsProxy(), {
      enableContactTools: true,
      enableMemoryTools: true,
    }),
    (toolName) => !ROOM_SCOPED_TOOL_NAMES.has(toolName),
  );

  return [...singleContext, ...roomScoped];
}

export const mcpTools: McpTool[] = buildMcpTools();

export function getMcpTool(name: string): McpTool | undefined {
  return mcpTools.find((tool) => tool.name === name);
}

export async function executeMcpTool(
  name: string,
  params: unknown,
): Promise<unknown> {
  const tool = getMcpTool(name);

  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }

  const result = await tool.execute((params ?? {}) as Record<string, unknown>);
  if (result.isError) {
    const message = result.content[0]?.text || `Tool ${name} failed`;
    throw new Error(message);
  }

  const text = result.content[0]?.text ?? "";
  if (text.length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export function getMcpToolSchemas(): Array<{
  name: string;
  description: string;
  inputSchema: McpToolInputSchema;
}> {
  return mcpTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}

export function getMcpToolRegistrations(): McpToolRegistration[] {
  return mcpTools;
}
