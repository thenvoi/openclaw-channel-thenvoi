/**
 * MCP Tools for Thenvoi platform operations.
 *
 * Exposes Thenvoi platform tools via MCP (Model Context Protocol)
 * for use by OpenClaw agents.
 */

import { getClient } from "./channel.js";
import type {
  AddParticipantParams,
  CreateChatroomParams,
  GetParticipantsParams,
  LookupPeersParams,
  RemoveParticipantParams,
  SendEventParams,
  SendMessageParams,
} from "./types.js";

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
    const client = getClient();

    if (!client) {
      throw new Error("Thenvoi client not connected");
    }

    const response = await client.lookupPeers(page, page_size);

    return {
      peers: response.peers.map((peer) => ({
        name: peer.name,
        type: peer.type,
        description: peer.description,
        status: peer.status,
      })),
      total: response.total_count,
      has_more: response.has_more,
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
      name: {
        type: "string",
        description: "Name of the agent or user to invite",
      },
      role: {
        type: "string",
        description: "Role for the participant (default: member)",
        default: "member",
        enum: ["owner", "admin", "member"],
      },
    },
    required: ["room_id", "name"],
  },
  handler: async (params: unknown) => {
    const { room_id, name, role = "member" } = params as AddParticipantParams;
    const client = getClient();

    if (!client) {
      throw new Error("Thenvoi client not connected");
    }

    const response = await client.addParticipant(room_id, name, role);

    return {
      success: true,
      participant: {
        name: response.name,
        type: response.type,
        role: response.role,
      },
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
    const client = getClient();

    if (!client) {
      throw new Error("Thenvoi client not connected");
    }

    await client.removeParticipant(room_id, name);

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
    const client = getClient();

    if (!client) {
      throw new Error("Thenvoi client not connected");
    }

    const participants = await client.getParticipants(room_id);

    return {
      participants: participants.map((p) => ({
        name: p.name,
        type: p.type,
        role: p.role,
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
    const client = getClient();

    if (!client) {
      throw new Error("Thenvoi client not connected");
    }

    const response = await client.createChat(task_id);

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
    const client = getClient();

    if (!client) {
      throw new Error("Thenvoi client not connected");
    }

    // Send event with optional metadata
    const response = await client.sendEvent(room_id, content, message_type, metadata);

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
        description:
          "List of participant names to @mention. At least one required. " +
          "Use thenvoi_get_participants to see available participants.",
      },
    },
    required: ["room_id", "content", "mentions"],
  },
  handler: async (params: unknown) => {
    const { room_id, content, mentions } = params as SendMessageParams;
    const client = getClient();

    if (!client) {
      throw new Error("Thenvoi client not connected");
    }

    if (!mentions || mentions.length === 0) {
      throw new Error("At least one mention is required to send a message");
    }

    // Get participants to resolve names to IDs
    const participants = await client.getParticipants(room_id);

    // Resolve mention names to participant objects
    const resolvedMentions = mentions.map((name) => {
      const participant = participants.find(
        (p) => p.name.toLowerCase() === name.toLowerCase()
      );
      if (!participant) {
        throw new Error(
          `Participant "${name}" not found in room. Use thenvoi_get_participants to see available participants.`
        );
      }
      return { id: participant.id, name: participant.name };
    });

    const response = await client.sendMessage(room_id, content, resolvedMentions);

    return {
      success: true,
      message_id: response.id,
      recipients: response.recipients,
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
