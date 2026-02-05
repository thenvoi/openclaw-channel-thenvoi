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
 * - THENVOI_WS_URL: WebSocket endpoint (default: wss://app.thenvoi.com/api/v1/socket)
 * - THENVOI_REST_URL: REST API endpoint (default: https://app.thenvoi.com)
 *
 * @packageDocumentation
 */

import { registerChannel, thenvoiChannel, setInboundCallback, setOpenClawRuntime } from "./channel.js";
import { getMcpToolSchemas } from "./mcp-tools.js";
import { BASE_INSTRUCTIONS } from "./prompts.js";

// =============================================================================
// Plugin Entry Point
// =============================================================================

// Hook context types (matching OpenClaw's plugin types)
interface PluginHookAgentContext {
  agentId?: string;
  sessionKey?: string;
  workspaceDir?: string;
  messageProvider?: string;
}

interface PluginHookBeforeAgentStartEvent {
  prompt: string;
  messages?: unknown[];
}

interface PluginHookBeforeAgentStartResult {
  systemPrompt?: string;
  prependContext?: string;
}

interface OpenClawPluginApi {
  registerChannel: (options: { plugin: typeof thenvoiChannel }) => void;
  registerMcpTools?: (tools: ReturnType<typeof getMcpToolSchemas>) => void;
  // OpenClaw provides a callback setter for inbound message delivery
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onInboundMessage?: (setter: any) => void;
  // Hook registration for lifecycle events
  on?: (
    hookName: "before_agent_start",
    handler: (
      event: PluginHookBeforeAgentStartEvent,
      ctx: PluginHookAgentContext
    ) => PluginHookBeforeAgentStartResult | void
  ) => void;
}

/**
 * OpenClaw plugin entry point.
 *
 * This function is called by OpenClaw when the plugin is loaded.
 * It registers the Thenvoi channel and MCP tools.
 *
 * Connection lifecycle is managed by the channel gateway (startAccount/stopAccount),
 * not by a separate service.
 */
export default function plugin(api: OpenClawPluginApi): void {
  // Debug: Log available API methods
  console.log("[thenvoi] OpenClaw Plugin API keys:", Object.keys(api));

  // Store OpenClaw runtime for message dispatch
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runtime = (api as any).runtime;
  if (runtime) {
    setOpenClawRuntime(runtime);
  }

  // Register the channel (handles connection via gateway.startAccount/stopAccount)
  registerChannel(api);

  // Register MCP tools if the API supports it
  if (api.registerMcpTools) {
    api.registerMcpTools(getMcpToolSchemas());
  }

  // Register before_agent_start hook to inject Thenvoi instructions
  // This ensures the LLM knows how to use thenvoi_send_message, thenvoi_send_event, etc.
  if (api.on) {
    api.on("before_agent_start", (_event, ctx) => {
      // Only inject for Thenvoi channel messages
      if (ctx.messageProvider === "thenvoi") {
        console.log("[thenvoi] Injecting BASE_INSTRUCTIONS into agent context");
        return {
          prependContext: BASE_INSTRUCTIONS,
        };
      }
      return undefined;
    });
    console.log("[thenvoi] Registered before_agent_start hook for instruction injection");
  }

  // Set up inbound message delivery - OpenClaw provides a callback for message delivery
  if (api.onInboundMessage) {
    api.onInboundMessage(setInboundCallback);
  }

  console.log("[thenvoi] Plugin loaded, channel registered");
}

// =============================================================================
// Named Exports
// =============================================================================

// Channel exports
export { thenvoiChannel, registerChannel, setInboundCallback, deliverMessage } from "./channel.js";
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
