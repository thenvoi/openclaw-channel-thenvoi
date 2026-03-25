/**
 * MCP Tools for Thenvoi platform operations.
 *
 * Exposes Thenvoi platform tools via MCP (Model Context Protocol)
 * for use by OpenClaw agents. Uses @thenvoi/sdk REST API.
 */

import { getLink, getAgentId } from "./channel.js";

// =============================================================================
// MCP Tool Types (local to this module)
// =============================================================================

interface LookupPeersParams { page?: number; page_size?: number }
interface AddParticipantParams { room_id: string; handle: string; role?: string }
interface RemoveParticipantParams { room_id: string; name: string }
interface GetParticipantsParams { room_id: string }
interface CreateChatroomParams { task_id?: string }
interface SendEventParams { room_id: string; content: string; message_type: string; metadata?: Record<string, unknown> }
interface SendMessageParams { room_id: string; content: string; mentions: string[] }
interface ListContactsParams { page?: number; page_size?: number }
interface AddContactParams { handle: string; message?: string }
interface RemoveContactParams { handle?: string; contact_id?: string }
interface ListContactRequestsParams { page?: number; page_size?: number; sent_status?: string }
interface RespondContactRequestParams { action: "approve" | "reject" | "cancel"; handle?: string; request_id?: string }

// =============================================================================
// MCP Tool Definitions
// =============================================================================

export interface McpTool {
  name: string;
  description: string;
  inputSchema: McpInputSchema;
  handler: (params: unknown) => Promise<unknown>;
}

interface McpInputSchema {
  type: "object";
  properties: Record<string, McpProperty>;
  required?: string[];
}

interface McpProperty {
  type: string;
  description: string;
  default?: unknown;
  enum?: string[];
  items?: { type: string };
}

// =============================================================================
// Helper: get REST API from link
// =============================================================================

function getRest() {
  const link = getLink();
  if (!link) {
    throw new Error("Thenvoi client not connected");
  }
  return link.rest;
}

/**
 * Assert that an optional REST method exists and return it bound to the rest object.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function requireMethod<T extends (...args: any[]) => any>(
  rest: object,
  method: T | undefined,
  name: string,
): T {
  if (!method) {
    throw new Error(`REST method "${name}" is not available on this API adapter`);
  }
  return method.bind(rest) as T;
}

// =============================================================================
// Tool: thenvoi_lookup_peers
// =============================================================================

const lookupPeersTool: McpTool = {
  name: "thenvoi_lookup_peers",
  description:
    "Find available agents and users on the Thenvoi platform. " +
    "Use this to discover who you can invite to collaborate.",
  inputSchema: {
    type: "object",
    properties: {
      page: {
        type: "number",
        description: "Page number for pagination (default: 1)",
        default: 1,
      },
      page_size: {
        type: "number",
        description: "Number of results per page (default: 50, max: 100)",
        default: 50,
      },
    },
  },
  handler: async (params: unknown) => {
    const { page = 1, page_size = 50 } = params as LookupPeersParams;
    const rest = getRest();

    const response = await requireMethod(rest, rest.listPeers, "listPeers")({ page, pageSize: page_size, notInChat: "" });

    return {
      peers: (response.data ?? []).map((peer) => ({
        id: peer.id,
        handle: peer.handle,
        name: peer.name,
        type: peer.type,
        description: peer.description,
      })),
      total: response.metadata?.totalCount ?? 0,
      has_more: (response.metadata?.page ?? 1) < (response.metadata?.totalPages ?? 1),
    };
  },
};

// =============================================================================
// Tool: thenvoi_add_participant
// =============================================================================

const addParticipantTool: McpTool = {
  name: "thenvoi_add_participant",
  description:
    "Invite an agent or user to join a Thenvoi chat room. " +
    "Use lookup_peers first to find available participants.",
  inputSchema: {
    type: "object",
    properties: {
      room_id: {
        type: "string",
        description: "The ID of the room to add the participant to",
      },
      handle: {
        type: "string",
        description:
          "Handle of the agent or user to invite (e.g., '@john' or '@john/agent-name'). " +
          "Can also be a name or UUID.",
      },
      role: {
        type: "string",
        description: "Role for the participant (default: member)",
        default: "member",
        enum: ["owner", "admin", "member"],
      },
    },
    required: ["room_id", "handle"],
  },
  handler: async (params: unknown) => {
    const { room_id, handle, role = "member" } = params as AddParticipantParams;
    const rest = getRest();

    // Lookup the peer to validate it exists and get canonical handle
    const peersResponse = await requireMethod(rest, rest.listPeers, "listPeers")({ page: 1, pageSize: 100, notInChat: "" });
    const normalizedHandle = handle.replace(/^@/, "").toLowerCase();
    const peer = (peersResponse.data ?? []).find(
      (p) =>
        p.name?.toLowerCase() === normalizedHandle ||
        p.handle?.toLowerCase() === normalizedHandle
    );

    if (!peer || !peer.id) {
      throw new Error(
        `Peer not found: "${handle}". Use thenvoi_lookup_peers to see available peers.`
      );
    }

    const response = await rest.addChatParticipant(room_id, { participantId: peer.id, role });

    return {
      success: true,
      participant: {
        id: peer.id,
        name: peer.name,
        type: peer.type,
        role,
      },
      response,
    };
  },
};

// =============================================================================
// Tool: thenvoi_remove_participant
// =============================================================================

const removeParticipantTool: McpTool = {
  name: "thenvoi_remove_participant",
  description: "Remove an agent or user from a Thenvoi chat room.",
  inputSchema: {
    type: "object",
    properties: {
      room_id: {
        type: "string",
        description: "The ID of the room to remove the participant from",
      },
      name: {
        type: "string",
        description: "Name of the agent or user to remove",
      },
    },
    required: ["room_id", "name"],
  },
  handler: async (params: unknown) => {
    const { room_id, name } = params as RemoveParticipantParams;
    const rest = getRest();

    await rest.removeChatParticipant(room_id, name);

    return {
      success: true,
      message: `Removed ${name} from room`,
    };
  },
};

// =============================================================================
// Tool: thenvoi_get_participants
// =============================================================================

const getParticipantsTool: McpTool = {
  name: "thenvoi_get_participants",
  description: "List all participants in a Thenvoi chat room.",
  inputSchema: {
    type: "object",
    properties: {
      room_id: {
        type: "string",
        description: "The ID of the room to list participants for",
      },
    },
    required: ["room_id"],
  },
  handler: async (params: unknown) => {
    const { room_id } = params as GetParticipantsParams;
    const rest = getRest();

    const participants = await rest.listChatParticipants(room_id);

    return {
      participants: participants.map((p) => ({
        name: p.name,
        type: p.type,
      })),
      count: participants.length,
    };
  },
};

// =============================================================================
// Tool: thenvoi_create_chatroom
// =============================================================================

const createChatTool: McpTool = {
  name: "thenvoi_create_chatroom",
  description:
    "Create a new Thenvoi chat room for collaboration. " +
    "Use this when you need a fresh space for a new task or conversation.",
  inputSchema: {
    type: "object",
    properties: {
      task_id: {
        type: "string",
        description: "Optional task ID to associate with the room",
      },
    },
  },
  handler: async (params: unknown) => {
    const { task_id } = params as CreateChatroomParams;
    const rest = getRest();

    const response = await rest.createChat(task_id);

    return {
      success: true,
      room_id: response.id,
      message: "Chat room created successfully",
    };
  },
};

// =============================================================================
// Tool: thenvoi_send_event
// =============================================================================

const sendEventTool: McpTool = {
  name: "thenvoi_send_event",
  description:
    "Share events with other participants in a Thenvoi chat room. " +
    "Event types: " +
    "'thought' - share your reasoning process (shows thinking indicator), " +
    "'error' - report problems or failures (shows error indicator), " +
    "'task' - report progress or status updates (shows progress indicator), " +
    "'tool_call' - report tool invocation (shows tool execution, include metadata with tool_call_id, name, args), " +
    "'tool_result' - report tool completion (shows tool result, include metadata with tool_call_id, name, output).",
  inputSchema: {
    type: "object",
    properties: {
      room_id: {
        type: "string",
        description: "The ID of the room to send the event to",
      },
      content: {
        type: "string",
        description: "Human-readable content of the event",
      },
      message_type: {
        type: "string",
        description: "Type of event",
        enum: ["thought", "error", "task", "tool_call", "tool_result"],
      },
      metadata: {
        type: "object",
        description:
          "Optional structured metadata. For tool_call: {tool_call_id, name, args}. " +
          "For tool_result: {tool_call_id, name, output, error?}",
      },
    },
    required: ["room_id", "content", "message_type"],
  },
  handler: async (params: unknown) => {
    const { room_id, content, message_type, metadata } = params as SendEventParams;
    const rest = getRest();

    const response = await rest.createChatEvent(room_id, {
      content,
      messageType: message_type,
      metadata,
    });

    return {
      success: true,
      event_id: response.id,
      message_type,
    };
  },
};

// =============================================================================
// Tool: thenvoi_send_message
// =============================================================================

const sendMessageTool: McpTool = {
  name: "thenvoi_send_message",
  description:
    "Send a message to a Thenvoi chat room. " +
    "Messages require at least one @mention. Use this to respond to users or other agents. " +
    "IMPORTANT: You MUST use this tool to communicate - plain text responses won't reach users.",
  inputSchema: {
    type: "object",
    properties: {
      room_id: {
        type: "string",
        description: "The ID of the room to send the message to (use the thread_id from the conversation)",
      },
      content: {
        type: "string",
        description: "The message content to send",
      },
      mentions: {
        type: "array",
        items: { type: "string" },
        description:
          "List of participant names to @mention. At least one required. " +
          "Use thenvoi_get_participants to see available participants.",
      },
    },
    required: ["room_id", "content", "mentions"],
  },
  handler: async (params: unknown) => {
    const { room_id, content, mentions } = params as SendMessageParams;
    const rest = getRest();

    if (!mentions || mentions.length === 0) {
      throw new Error("At least one mention is required to send a message");
    }

    const selfAgentId = getAgentId();

    // Get participants to resolve names to IDs
    const participants = await rest.listChatParticipants(room_id);

    // Resolve mention names to participant objects
    const resolvedMentions = mentions.map((name) => {
      const participant = participants.find(
        (p) => p.name.toLowerCase() === name.toLowerCase() && p.id !== selfAgentId
      );
      if (!participant) {
        throw new Error(
          `Participant "${name}" not found in room (excluding self). Use thenvoi_get_participants to see available participants.`
        );
      }
      return { id: participant.id, name: participant.name };
    });

    const response = await rest.createChatMessage(room_id, {
      content,
      mentions: resolvedMentions,
    });

    return {
      success: true,
      message_id: response.id,
      response,
    };
  },
};

// =============================================================================
// Tool: thenvoi_list_contacts
// =============================================================================

const listContactsTool: McpTool = {
  name: "thenvoi_list_contacts",
  description: "List agent's contacts with pagination.",
  inputSchema: {
    type: "object",
    properties: {
      page: {
        type: "number",
        description: "Page number (default: 1)",
        default: 1,
      },
      page_size: {
        type: "number",
        description: "Items per page (default: 50, max: 100)",
        default: 50,
      },
    },
  },
  handler: async (params: unknown) => {
    const { page = 1, page_size = 50 } = params as ListContactsParams;
    const rest = getRest();

    const response = await requireMethod(rest, rest.listContacts, "listContacts")({ page, pageSize: page_size });

    return {
      contacts: (response.data ?? []).map((c) => ({
        id: c.id,
        handle: c.handle,
        name: c.name,
        type: c.type,
      })),
      metadata: response.metadata,
    };
  },
};

// =============================================================================
// Tool: thenvoi_add_contact
// =============================================================================

const addContactTool: McpTool = {
  name: "thenvoi_add_contact",
  description:
    "Send a contact request to add someone as a contact. " +
    "Returns 'pending' when request is created, 'approved' when auto-accepted " +
    "(if they already sent you a request).",
  inputSchema: {
    type: "object",
    properties: {
      handle: {
        type: "string",
        description: "Handle of user/agent to add (e.g., '@john' or '@john/agent-name')",
      },
      message: {
        type: "string",
        description: "Optional message with the request",
      },
    },
    required: ["handle"],
  },
  handler: async (params: unknown) => {
    const { handle, message } = params as AddContactParams;
    const rest = getRest();

    const response = await requireMethod(rest, rest.addContact, "addContact")({ handle, message });

    return {
      success: true,
      ...response,
    };
  },
};

// =============================================================================
// Tool: thenvoi_remove_contact
// =============================================================================

const removeContactTool: McpTool = {
  name: "thenvoi_remove_contact",
  description: "Remove an existing contact by handle or ID.",
  inputSchema: {
    type: "object",
    properties: {
      handle: {
        type: "string",
        description: "Contact's handle",
      },
      contact_id: {
        type: "string",
        description: "Or contact record ID (UUID)",
      },
    },
  },
  handler: async (params: unknown) => {
    const { handle, contact_id } = params as RemoveContactParams;
    const rest = getRest();

    if (!handle && !contact_id) {
      throw new Error("Either handle or contact_id is required");
    }

    const removeArgs = handle
      ? { target: "handle" as const, handle }
      : { target: "contactId" as const, contactId: contact_id! };

    await requireMethod(rest, rest.removeContact, "removeContact")(removeArgs);

    return {
      success: true,
      message: "Contact removed",
    };
  },
};

// =============================================================================
// Tool: thenvoi_list_contact_requests
// =============================================================================

const listContactRequestsTool: McpTool = {
  name: "thenvoi_list_contact_requests",
  description:
    "List both received and sent contact requests. " +
    "Received requests are always filtered to pending status. " +
    "Sent requests can be filtered by status.",
  inputSchema: {
    type: "object",
    properties: {
      page: {
        type: "number",
        description: "Page number (default: 1)",
        default: 1,
      },
      page_size: {
        type: "number",
        description: "Items per page per direction (default: 50, max: 100)",
        default: 50,
      },
      sent_status: {
        type: "string",
        description: "Filter sent requests by status (default: pending)",
        default: "pending",
        enum: ["pending", "approved", "rejected", "cancelled", "all"],
      },
    },
  },
  handler: async (params: unknown) => {
    const { page = 1, page_size = 50, sent_status = "pending" } = params as ListContactRequestsParams;
    const rest = getRest();

    const response = await requireMethod(rest, rest.listContactRequests, "listContactRequests")({ page, pageSize: page_size, sentStatus: sent_status });

    return {
      received: (response.received ?? []).map((r) => ({
        id: r.id,
        from_handle: r.from_handle,
        from_name: r.from_name,
        message: r.message,
        status: r.status,
      })),
      sent: (response.sent ?? []).map((s) => ({
        id: s.id,
        to_handle: s.to_handle,
        to_name: s.to_name,
        message: s.message,
        status: s.status,
      })),
      metadata: response.metadata,
    };
  },
};

// =============================================================================
// Tool: thenvoi_respond_contact_request
// =============================================================================

const respondContactRequestTool: McpTool = {
  name: "thenvoi_respond_contact_request",
  description:
    "Respond to a contact request. " +
    "Actions: 'approve'/'reject' for requests you RECEIVED, " +
    "'cancel' for requests you SENT.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "Action to take",
        enum: ["approve", "reject", "cancel"],
      },
      handle: {
        type: "string",
        description: "Other party's handle",
      },
      request_id: {
        type: "string",
        description: "Or request ID (UUID)",
      },
    },
    required: ["action"],
  },
  handler: async (params: unknown) => {
    const { action, handle, request_id } = params as RespondContactRequestParams;
    const rest = getRest();

    if (!handle && !request_id) {
      throw new Error("Either handle or request_id is required");
    }

    const respondArgs = handle
      ? { action, target: "handle" as const, handle }
      : { action, target: "requestId" as const, requestId: request_id! };

    const response = await requireMethod(rest, rest.respondContactRequest, "respondContactRequest")(respondArgs);

    return {
      success: true,
      ...response,
    };
  },
};

// =============================================================================
// Export All Tools
// =============================================================================

export const mcpTools: McpTool[] = [
  lookupPeersTool,
  addParticipantTool,
  removeParticipantTool,
  getParticipantsTool,
  createChatTool,
  sendEventTool,
  sendMessageTool,
  // Contact tools
  listContactsTool,
  addContactTool,
  removeContactTool,
  listContactRequestsTool,
  respondContactRequestTool,
];

/**
 * Get a tool by name.
 */
export function getMcpTool(name: string): McpTool | undefined {
  return mcpTools.find((tool) => tool.name === name);
}

/**
 * Execute a tool by name.
 */
export async function executeMcpTool(
  name: string,
  params: unknown,
): Promise<unknown> {
  const tool = getMcpTool(name);

  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }

  return tool.handler(params);
}

/**
 * Get all tool schemas for registration.
 */
export function getMcpToolSchemas(): Array<{
  name: string;
  description: string;
  inputSchema: McpInputSchema;
}> {
  return mcpTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}
