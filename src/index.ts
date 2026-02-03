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
 * - THENVOI_API_KEY_USER: User identifier on Thenvoi
 *
 * Optional environment variables:
 * - THENVOI_WS_URL: WebSocket endpoint (default: wss://api.thenvoi.com/ws)
 * - THENVOI_REST_URL: REST API endpoint (default: https://api.thenvoi.com)
 *
 * @packageDocumentation
 */

import { registerChannel, thenvoiChannel, setInboundCallback, deliverMessage } from "./channel.js";
import { getMcpToolSchemas } from "./mcp-tools.js";
import { ThenvoiRuntime } from "./runtime.js";
import { ThenvoiClient } from "./thenvoi-client.js";
import { BASE_INSTRUCTIONS } from "./prompts.js";
import type { ThenvoiConfig, OpenClawInboundMessage } from "./types.js";

// =============================================================================
// Plugin Entry Point
// =============================================================================

interface PluginLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  debug: (msg: string) => void;
}

interface PluginServiceContext {
  config: Record<string, unknown>;
  workspaceDir?: string;
  stateDir: string;
  logger: PluginLogger;
}

interface PluginService {
  id: string;
  start: (ctx: PluginServiceContext) => void | Promise<void>;
  stop?: (ctx: PluginServiceContext) => void | Promise<void>;
}

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
  registerService?: (service: PluginService) => void;
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

// Active runtime (for auto-start mode)
let activeRuntime: ThenvoiRuntime | null = null;
let activeClient: ThenvoiClient | null = null;

// OpenClaw runtime for message dispatch
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let openclawRuntime: any = null;

/**
 * Create the Thenvoi connection service.
 * This service manages the WebSocket connection lifecycle.
 */
function createThenvoiService(): PluginService {
  return {
    id: "thenvoi-connection",

    async start(ctx: PluginServiceContext): Promise<void> {
      const logger = ctx.logger;
      logger.info("Starting Thenvoi connection service...");

      const apiKey = process.env.THENVOI_API_KEY;
      const agentId = process.env.THENVOI_AGENT_ID;
      const userId = process.env.THENVOI_API_KEY_USER;
      const wsUrl = process.env.THENVOI_WS_URL ?? "wss://api.thenvoi.com/socket";
      const restUrl = process.env.THENVOI_REST_URL ?? "https://api.thenvoi.com";

      if (!apiKey || !agentId || !userId) {
        logger.warn("Skipping Thenvoi connection: missing required environment variables (THENVOI_API_KEY, THENVOI_AGENT_ID, THENVOI_API_KEY_USER)");
        return;
      }

      logger.info(`Connecting to Thenvoi as agent ${agentId}...`);

      const config: ThenvoiConfig = { apiKey, agentId, userId, wsUrl, restUrl };

      // Create REST client
      activeClient = new ThenvoiClient(config);

      // Create and start runtime
      activeRuntime = new ThenvoiRuntime(
        config,
        {
          onMessage: async (message: OpenClawInboundMessage) => {
            logger.info(`Received message from ${message.senderName}: ${message.text?.substring(0, 50)}...`);

            // Try to dispatch using OpenClaw's channel reply system
            if (openclawRuntime?.channel?.reply?.dispatchReplyFromConfig && activeClient) {
              try {
                // Create a reply dispatcher matching OpenClaw's ReplyDispatcher interface
                const queuedCounts = { tool: 0, block: 0, final: 0 };

                // Helper to send a message to Thenvoi
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const sendToThenvoi = async (payload: any): Promise<boolean> => {
                  const text = typeof payload === "string" ? payload : payload?.text;
                  if (!text) {
                    logger.warn(`No text in payload, skipping`);
                    return false;
                  }
                  logger.info(`Sending reply: ${text.substring(0, 50)}...`);
                  try {
                    // Use threadId (room ID) from the message
                    const roomId = message.threadId;
                    // Get participants for mention resolution
                    const participants = await activeClient!.getParticipants(roomId);
                    const agent = await activeClient!.getAgentMe();

                    // Find a participant to mention (excluding self)
                    const otherParticipant = participants.find((p) => p.id !== agent.id);
                    const mentions = otherParticipant
                      ? [{ id: otherParticipant.id, name: otherParticipant.name }]
                      : [];

                    if (mentions.length === 0) {
                      logger.warn(`No participants to mention, skipping reply`);
                      return false;
                    }

                    await activeClient!.sendMessage(roomId, text, mentions);
                    logger.info(`Reply sent successfully`);
                    return true;
                  } catch (error) {
                    logger.error(`Failed to send reply: ${error}`);
                    return false;
                  }
                };

                const dispatcher = {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  sendToolResult: (payload: any): boolean => {
                    queuedCounts.tool++;
                    void sendToThenvoi(payload);
                    return true;
                  },
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  sendBlockReply: (payload: any): boolean => {
                    queuedCounts.block++;
                    void sendToThenvoi(payload);
                    return true;
                  },
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  sendFinalReply: (payload: any): boolean => {
                    queuedCounts.final++;
                    void sendToThenvoi(payload);
                    return true;
                  },
                  waitForIdle: async (): Promise<void> => {
                    // No-op - we don't have a queue to wait on
                    return Promise.resolve();
                  },
                  getQueuedCounts: () => ({ ...queuedCounts }),
                };

                // Format the inbound context matching OpenClaw's FinalizedMsgContext
                const inboundCtx = {
                  // Message content
                  Body: message.text,
                  RawBody: message.text,
                  BodyForCommands: message.text,
                  CommandBody: message.text,
                  // Sender info
                  From: message.senderId,
                  SenderId: message.senderId,
                  SenderName: message.senderName,
                  // Destination/thread
                  To: message.threadId,
                  SessionKey: `thenvoi:${message.threadId}`,
                  // Channel info
                  Surface: "thenvoi",
                  Provider: "thenvoi",
                  // Message metadata
                  MessageSid: message.metadata?.messageId,
                  Timestamp: message.timestamp ? new Date(message.timestamp).getTime() : Date.now(),
                  ChatType: "group",
                  // Required by FinalizedMsgContext
                  CommandAuthorized: true,
                };

                logger.info(`Dispatching message to OpenClaw agent...`);
                await openclawRuntime.channel.reply.dispatchReplyFromConfig({
                  ctx: inboundCtx,
                  cfg: openclawRuntime.config,
                  dispatcher,
                });
                logger.info(`Message dispatched successfully`);
              } catch (error) {
                logger.error(`Failed to dispatch message: ${error}`);
              }
            } else {
              // Fallback to old delivery method
              deliverMessage(message);
            }
          },
          onRoomJoined: (roomId, title) => {
            logger.info(`Joined room: ${title} (${roomId})`);
          },
          onRoomLeft: (roomId) => {
            logger.info(`Left room: ${roomId}`);
          },
          onError: (error) => {
            logger.error(`Connection error: ${error.message}`);
          },
          onReconnecting: (attempt) => {
            logger.info(`Reconnecting (attempt ${attempt})...`);
          },
          onReconnected: () => {
            logger.info(`Reconnected successfully`);
          },
          onSyncStarted: () => {
            logger.info(`Starting message sync...`);
          },
          onSyncCompleted: (count) => {
            logger.info(`Sync complete, processed ${count} messages`);
          },
          onSyncError: (error) => {
            logger.error(`Sync error: ${error.message}`);
          },
        },
        activeClient,
      );

      await activeRuntime.connect();
      logger.info("Connected to Thenvoi platform");
    },

    async stop(ctx: PluginServiceContext): Promise<void> {
      const logger = ctx.logger;
      logger.info("Stopping Thenvoi connection service...");

      if (activeRuntime) {
        activeRuntime.disconnect();
        activeRuntime = null;
      }
      activeClient = null;

      logger.info("Thenvoi connection service stopped");
    },
  };
}

/**
 * OpenClaw plugin entry point.
 *
 * This function is called by OpenClaw when the plugin is loaded.
 * It registers the Thenvoi channel and MCP tools.
 */
export default function plugin(api: OpenClawPluginApi): void {
  // Debug: Log available API methods
  console.log("[thenvoi] OpenClaw Plugin API keys:", Object.keys(api));

  // Store OpenClaw runtime for message dispatch
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  openclawRuntime = (api as any).runtime;
  if (openclawRuntime?.channel?.reply) {
    console.log("[thenvoi] OpenClaw dispatch methods available");
  }

  // Register the channel
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

  // Register the connection service for lifecycle management
  if (api.registerService) {
    api.registerService(createThenvoiService());
    console.log("[thenvoi] Plugin loaded, connection service registered");
  } else {
    // Fallback: auto-start if registerService is not available
    console.log("[thenvoi] Plugin loaded, using auto-start fallback");
    autoStart().catch((err) => {
      console.error("[thenvoi] Auto-start failed:", err.message);
    });
  }
}

/**
 * Auto-start the Thenvoi connection if configured via environment variables.
 */
async function autoStart(): Promise<void> {
  const apiKey = process.env.THENVOI_API_KEY;
  const agentId = process.env.THENVOI_AGENT_ID;
  const userId = process.env.THENVOI_API_KEY_USER;
  const wsUrl = process.env.THENVOI_WS_URL ?? "wss://api.thenvoi.com/socket";
  const restUrl = process.env.THENVOI_REST_URL ?? "https://api.thenvoi.com";

  if (!apiKey || !agentId || !userId) {
    console.log("[thenvoi] Skipping auto-start: missing required environment variables");
    return;
  }

  console.log("[thenvoi] Auto-starting with environment configuration...");

  const config: ThenvoiConfig = { apiKey, agentId, userId, wsUrl, restUrl };

  // Create REST client
  activeClient = new ThenvoiClient(config);

  // Create and start runtime
  activeRuntime = new ThenvoiRuntime(
    config,
    {
      onMessage: async (message: OpenClawInboundMessage) => {
        console.log(`[thenvoi] Received message from ${message.senderName}: ${message.text?.substring(0, 50)}...`);

        // Try to dispatch using OpenClaw's channel reply system
        if (openclawRuntime?.channel?.reply?.dispatchReplyFromConfig && activeClient) {
          try {
            // Create a reply dispatcher matching OpenClaw's ReplyDispatcher interface
            const queuedCounts = { tool: 0, block: 0, final: 0 };

            // Helper to send a message to Thenvoi
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const sendToThenvoi = async (payload: any): Promise<boolean> => {
              const text = typeof payload === "string" ? payload : payload?.text;
              if (!text) {
                console.log(`[thenvoi] No text in payload, skipping`);
                return false;
              }
              console.log(`[thenvoi] Sending reply: ${text.substring(0, 50)}...`);
              try {
                const roomId = message.threadId;
                const participants = await activeClient!.getParticipants(roomId);
                const agent = await activeClient!.getAgentMe();
                const otherParticipant = participants.find((p) => p.id !== agent.id);
                const mentions = otherParticipant
                  ? [{ id: otherParticipant.id, name: otherParticipant.name }]
                  : [];

                if (mentions.length === 0) {
                  console.log(`[thenvoi] No participants to mention, skipping reply`);
                  return false;
                }

                await activeClient!.sendMessage(roomId, text, mentions);
                console.log(`[thenvoi] Reply sent successfully`);
                return true;
              } catch (error) {
                console.error(`[thenvoi] Failed to send reply:`, error);
                return false;
              }
            };

            const dispatcher = {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              sendToolResult: (payload: any): boolean => {
                queuedCounts.tool++;
                void sendToThenvoi(payload);
                return true;
              },
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              sendBlockReply: (payload: any): boolean => {
                queuedCounts.block++;
                void sendToThenvoi(payload);
                return true;
              },
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              sendFinalReply: (payload: any): boolean => {
                queuedCounts.final++;
                void sendToThenvoi(payload);
                return true;
              },
              waitForIdle: async (): Promise<void> => Promise.resolve(),
              getQueuedCounts: () => ({ ...queuedCounts }),
            };

            // Format the inbound context matching OpenClaw's FinalizedMsgContext
            const inboundCtx = {
              // Message content
              Body: message.text,
              RawBody: message.text,
              BodyForCommands: message.text,
              CommandBody: message.text,
              // Sender info
              From: message.senderId,
              SenderId: message.senderId,
              SenderName: message.senderName,
              // Destination/thread
              To: message.threadId,
              SessionKey: `thenvoi:${message.threadId}`,
              // Channel info
              Surface: "thenvoi",
              Provider: "thenvoi",
              // Message metadata
              MessageSid: message.metadata?.messageId,
              Timestamp: message.timestamp ? new Date(message.timestamp).getTime() : Date.now(),
              ChatType: "group",
              // Required by FinalizedMsgContext
              CommandAuthorized: true,
            };

            console.log(`[thenvoi] Dispatching message to OpenClaw agent...`);
            await openclawRuntime.channel.reply.dispatchReplyFromConfig({
              ctx: inboundCtx,
              cfg: openclawRuntime.config,
              dispatcher,
            });
            console.log(`[thenvoi] Message dispatched successfully`);
          } catch (error) {
            console.error(`[thenvoi] Failed to dispatch message:`, error);
          }
        } else {
          deliverMessage(message);
        }
      },
      onRoomJoined: (roomId, title) => {
        console.log(`[thenvoi] Joined room: ${title} (${roomId})`);
      },
      onRoomLeft: (roomId) => {
        console.log(`[thenvoi] Left room: ${roomId}`);
      },
      onError: (error) => {
        console.error(`[thenvoi] Error:`, error.message);
      },
      onReconnecting: (attempt) => {
        console.log(`[thenvoi] Reconnecting (attempt ${attempt})...`);
      },
      onReconnected: () => {
        console.log(`[thenvoi] Reconnected successfully`);
      },
      onSyncStarted: () => {
        console.log(`[thenvoi] Starting message sync...`);
      },
      onSyncCompleted: (count) => {
        console.log(`[thenvoi] Sync complete, processed ${count} messages`);
      },
      onSyncError: (error) => {
        console.error(`[thenvoi] Sync error:`, error.message);
      },
    },
    activeClient,
  );

  await activeRuntime.connect();
  console.log("[thenvoi] Connected to Thenvoi platform");
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
