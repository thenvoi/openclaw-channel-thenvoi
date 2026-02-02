/**
 * OpenClaw Channel Plugin for Thenvoi.
 *
 * This plugin enables OpenClaw agents to connect to the Thenvoi platform,
 * allowing them to:
 *
 * 1. Receive messages from other Thenvoi agents and users
 * 2. Send messages back to Thenvoi chat rooms
 * 3. Use platform tools (lookup peers, manage participants, create rooms)
 * 4. Participate in multiple rooms simultaneously
 *
 * @example
 * ```yaml
 * # openclaw.yaml
 * channels:
 *   thenvoi:
 *     accounts:
 *       default:
 *         enabled: true
 * ```
 *
 * Required environment variables:
 * - THENVOI_API_KEY: API key for authentication
 * - THENVOI_AGENT_ID: Agent identifier on Thenvoi
 *
 * Optional environment variables:
 * - THENVOI_WS_URL: WebSocket endpoint (default: wss://api.thenvoi.com/ws)
 * - THENVOI_REST_URL: REST API endpoint (default: https://api.thenvoi.com)
 *
 * @packageDocumentation
 */

import { registerChannel, thenvoiChannel, setInboundCallback } from "./channel.js";
import { getMcpToolSchemas } from "./mcp-tools.js";

// =============================================================================
// Plugin Entry Point
// =============================================================================

interface OpenClawPluginApi {
  registerChannel: (options: { plugin: typeof thenvoiChannel }) => void;
  registerMcpTools?: (tools: ReturnType<typeof getMcpToolSchemas>) => void;
  setInboundHandler?: (handler: Parameters<typeof setInboundCallback>[0]) => void;
}

/**
 * OpenClaw plugin entry point.
 *
 * This function is called by OpenClaw when the plugin is loaded.
 * It registers the Thenvoi channel and MCP tools.
 */
export default function plugin(api: OpenClawPluginApi): void {
  // Register the channel
  registerChannel(api);

  // Register MCP tools if the API supports it
  if (api.registerMcpTools) {
    api.registerMcpTools(getMcpToolSchemas());
  }

  // Set up inbound message handler if provided
  if (api.setInboundHandler) {
    api.setInboundHandler((message) => {
      // This will be called by OpenClaw to set up the delivery callback
      setInboundCallback(() => message);
    });
  }

  console.log("[thenvoi] Plugin loaded successfully");
}

// =============================================================================
// Named Exports
// =============================================================================

// Channel exports
export { thenvoiChannel, registerChannel, setInboundCallback } from "./channel.js";
export { getClient, getRuntime } from "./channel.js";

// Runtime exports
export { ThenvoiRuntime } from "./runtime.js";
export type { RuntimeCallbacks } from "./runtime.js";

// Client exports
export { ThenvoiClient } from "./thenvoi-client.js";

// MCP tool exports
export { mcpTools, getMcpToolSchemas, executeMcpTool, getMcpTool } from "./mcp-tools.js";

// Prompt exports
export { BASE_INSTRUCTIONS, buildSystemPrompt } from "./prompts.js";

// Type exports
export type {
  // Configuration
  ThenvoiConfig,
  ThenvoiAccountConfig,
  ThenvoiChannelConfig,
  // Messages
  MessageCreatedPayload,
  MessageMetadata,
  MessageType,
  Mention,
  // Rooms
  RoomAddedPayload,
  RoomRemovedPayload,
  RoomState,
  // Participants
  Participant,
  ParticipantAddedPayload,
  ParticipantRemovedPayload,
  ParticipantRole,
  // Peers
  Peer,
  LookupPeersResponse,
  // OpenClaw integration
  OpenClawInboundMessage,
  OpenClawOutboundMessage,
  // MCP tool params
  LookupPeersParams,
  AddParticipantParams,
  RemoveParticipantParams,
  GetParticipantsParams,
  CreateChatroomParams,
  SendEventParams,
  // Errors
  ThenvoiError,
  ThenvoiConnectionError,
  ThenvoiAuthError,
} from "./types.js";
