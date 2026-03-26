/**
 * OpenClaw Channel Plugin for Thenvoi.
 *
 * This plugin enables OpenClaw agents to connect to the Thenvoi platform,
 * using @thenvoi/sdk for all platform communication.
 *
 * @packageDocumentation
 */

import { registerChannel, thenvoiChannel, setInboundCallback, setOpenClawRuntime } from "./channel.js";
import { getMcpToolSchemas, executeMcpTool } from "./mcp-tools.js";
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
  onInboundMessage?: (setter: (cb: (message: unknown) => void) => void) => void;
  // Hook registration for lifecycle events
  on?: (
    hookName: "before_agent_start",
    handler: (
      event: PluginHookBeforeAgentStartEvent,
      ctx: PluginHookAgentContext
    ) => PluginHookBeforeAgentStartResult | void
  ) => void;
  // OpenClaw runtime reference for dispatch (not in public API, provided dynamically)
  runtime?: unknown;
  // Tool registration (singular, provided dynamically by OpenClaw)
  registerTool?: (tool: {
    name: string;
    description: string;
    parameters: unknown;
    execute: (toolCallId: unknown, input: unknown) => Promise<unknown>;
  }) => void;
}

/**
 * OpenClaw plugin entry point.
 */
export default function plugin(api: OpenClawPluginApi): void {
  console.log("[thenvoi] OpenClaw Plugin API keys:", Object.keys(api));

  // Store OpenClaw runtime for message dispatch
  if (api.runtime) {
    setOpenClawRuntime(api.runtime);
  }

  // Register the channel (handles connection via gateway.startAccount/stopAccount)
  registerChannel(api);

  // Register MCP tools - OpenClaw uses registerTool (singular) for each tool
  if (api.registerTool) {
    const registerTool = api.registerTool;
    const toolSchemas = getMcpToolSchemas();
    console.log(`[thenvoi] Registering ${toolSchemas.length} tools:`, toolSchemas.map(t => t.name));
    for (const tool of toolSchemas) {
      registerTool({
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
        execute: async (_toolCallId: unknown, input: unknown) => {
          console.log(`[thenvoi] Executing tool ${tool.name}`);
          try {
            const result = await executeMcpTool(tool.name, input ?? {});
            const resultStr = JSON.stringify(result, null, 2);
            console.log(`[thenvoi] Tool ${tool.name} completed`);

            return {
              content: [{ type: "text", text: resultStr }],
              details: result,
            };
          } catch (error) {
            console.error(`[thenvoi] Tool ${tool.name} error:`, error);
            throw error;
          }
        },
      });
    }
    console.log("[thenvoi] Tools registered successfully");
  } else {
    console.warn("[thenvoi] WARNING: api.registerTool is not available - tools will NOT be registered!");
    console.warn("[thenvoi] Available API methods:", Object.keys(api));
  }

  // Register before_agent_start hook to inject Thenvoi instructions + room context
  if (api.on) {
    api.on("before_agent_start", (_event, ctx) => {
      console.log(`[thenvoi] before_agent_start hook called (messageProvider=${ctx.messageProvider}, sessionKey=${ctx.sessionKey})`);

      // Extract room_id from sessionKey (format: "thenvoi:{roomId}")
      const roomId = ctx.sessionKey?.startsWith("thenvoi:") ? ctx.sessionKey.slice("thenvoi:".length) : undefined;

      let prependContext = BASE_INSTRUCTIONS;
      if (roomId) {
        prependContext += `\n\n## Current Thenvoi Room\n\n**Your current room_id is: \`${roomId}\`**\nUse this value for any tool parameter that asks for \`room_id\`. Do NOT use any other UUID.`;
      }

      return { prependContext };
    });
    console.log("[thenvoi] Registered before_agent_start hook for instruction injection");
  }

  // Set up inbound message delivery
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
export { getLink, getAgentId, resetGatewayRegistry } from "./channel.js";

// OpenClaw-specific type exports
export type { ThenvoiAccountConfig, OpenClawInboundMessage } from "./channel.js";

// MCP tool exports
export { mcpTools, getMcpToolSchemas, executeMcpTool, getMcpTool } from "./mcp-tools.js";

// Prompt exports
export {
  BASE_INSTRUCTIONS,
  CORE_INSTRUCTIONS,
  CONTACT_INSTRUCTIONS,
  buildSystemPrompt,
} from "./prompts.js";

// Re-export key SDK types for consumers
export type {
  ContactEventConfig,
  ContactEventStrategy,
  ContactEventCallback,
  ContactEvent,
  PlatformEvent,
} from "@thenvoi/sdk";

export { ThenvoiLink } from "@thenvoi/sdk";

export type {
  AgentIdentity,
  ChatParticipant,
} from "@thenvoi/sdk/rest";

export { ContactEventHandler, RoomPresence } from "@thenvoi/sdk/runtime";
