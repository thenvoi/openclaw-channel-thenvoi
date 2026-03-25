import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";

import { thenvoiChannel, setInboundCallback, setOpenClawRuntime } from "./channel.js";
import { getMcpToolRegistrations } from "./mcp-tools.js";
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

interface PluginHookBeforePromptBuildEvent {
  prompt: string;
  messages: unknown[];
}

interface PluginHookBeforePromptBuildResult {
  systemPrompt?: string;
  prependContext?: string;
  prependSystemContext?: string;
}

interface OpenClawPluginApi {
  // OpenClaw provides a callback setter for inbound message delivery
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onInboundMessage?: (setter: any) => void;
  // Hook registration for lifecycle events
  on?: (
    hookName: "before_prompt_build" | "before_agent_start",
    handler: (
      event: PluginHookBeforePromptBuildEvent | PluginHookBeforeAgentStartEvent,
      ctx: PluginHookAgentContext
    ) => PluginHookBeforePromptBuildResult | PluginHookBeforeAgentStartResult | void
  ) => void;
}

const plugin = defineChannelPluginEntry({
  id: "openclaw-channel-thenvoi",
  name: "Thenvoi",
  description: "Connect OpenClaw to the Thenvoi AI agent collaboration platform",
  plugin: thenvoiChannel,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setRuntime: (runtime: any) => {
    setOpenClawRuntime(runtime);
  },
  registerFull(api) {
    const compatApi = api as unknown as OpenClawPluginApi;
    const registerTool = (compatApi as { registerTool?: (tool: unknown) => void }).registerTool;

    if (registerTool) {
      const registrations = getMcpToolRegistrations();
      for (const tool of registrations) {
        registerTool({
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
          execute: async (_toolCallId: unknown, input: unknown) =>
            tool.execute((input ?? {}) as Record<string, unknown>),
        });
      }
    } else {
      console.warn("[thenvoi] WARNING: api.registerTool is not available - tools will NOT be registered!");
    }

    if (compatApi.on) {
      compatApi.on("before_prompt_build", (_event, _ctx) => ({
        prependSystemContext: BASE_INSTRUCTIONS,
      }));
    }

    if (compatApi.onInboundMessage) {
      compatApi.onInboundMessage(setInboundCallback);
    }
  },
});

export default plugin;

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

// WebSocket exports
export { RateLimitAwareWebSocket } from "./rate-limit-websocket.js";

// MCP tool exports
export {
  mcpTools,
  getMcpTool,
  getMcpToolRegistrations,
  getMcpToolSchemas,
  executeMcpTool,
} from "./mcp-tools.js";

// Prompt exports
export {
  BASE_INSTRUCTIONS,
  CORE_INSTRUCTIONS,
  CONTACT_INSTRUCTIONS,
  HUB_ROOM_SYSTEM_PROMPT,
  buildSystemPrompt,
} from "./prompts.js";

// Contact handler exports
export { ContactEventHandler } from "./contact-handler.js";
export type { HubEventCallback, HubInitCallback, BroadcastCallback, ContactEventHandlerOptions } from "./contact-handler.js";

// Type exports
export type {
  // Configuration
  ThenvoiConfig,
  ThenvoiAccountConfig,
  ThenvoiChannelConfig,
  // Contact event configuration
  ContactEventStrategy,
  ContactEventConfig,
  ContactEventCallback,
  ContactEvent,
  ContactRequestReceivedPayload,
  ContactRequestUpdatedPayload,
  ContactAddedPayload,
  ContactRemovedPayload,
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
