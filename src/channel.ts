/**
 * Thenvoi Channel Plugin for OpenClaw.
 *
 * Registers the Thenvoi channel with OpenClaw Gateway,
 * enabling bidirectional communication with the Thenvoi platform.
 */

import type {
  ContactEvent,
  ContactEventConfig,
  ContactRequestReceivedPayload,
  MentionRequest,
  OpenClawInboundMessage,
  ThenvoiAccountConfig,
  ThenvoiConfig,
} from "./types.js";
import { ThenvoiClient } from "./thenvoi-client.js";
import { ThenvoiRuntime } from "./runtime.js";

// =============================================================================
// Types for OpenClaw Plugin API
// =============================================================================

interface OpenClawChannelApi {
  registerChannel: (options: { plugin: OpenClawChannel }) => void;
}

interface OpenClawChannel {
  id: string;
  meta: ChannelMeta;
  capabilities: ChannelCapabilities;
  config: ChannelConfigHelpers;
  outbound: OutboundAdapter;
  setup?: SetupHelpers;
  gateway?: GatewayHelpers;
  threading?: ThreadingHelpers;
  messaging?: MessagingHelpers;
}

interface ChannelMeta {
  id: string;
  label: string;
  selectionLabel: string;
  docsPath: string;
  blurb: string;
  aliases: string[];
}

interface ChannelCapabilities {
  chatTypes: ("direct" | "group")[];
  features?: string[];
}

interface ChannelConfigHelpers {
  listAccountIds: (config: PluginConfig) => string[];
  resolveAccount: (config: PluginConfig, accountId?: string) => ThenvoiAccountConfig;
}

interface OutboundContext {
  cfg: unknown;
  to: string;
  text: string;
  mediaUrl?: string;
  threadId?: string | number | null;
  accountId?: string | null;
}

interface OutboundDeliveryResult {
  channel: string;
  messageId: string;
  chatId?: string;
  roomId?: string;
}

interface OutboundAdapter {
  deliveryMode: "direct" | "queued";
  resolveTarget?: (params: { to?: string; allowFrom?: string[]; mode?: string }) => { ok: true; to: string } | { ok: false; error: Error };
  sendText: (ctx: OutboundContext) => Promise<OutboundDeliveryResult>;
  sendMedia: (ctx: OutboundContext) => Promise<OutboundDeliveryResult>;
}

interface SetupHelpers {
  validateConfig?: (config: ThenvoiAccountConfig) => Promise<ValidationResult>;
}

interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

interface GatewayContext {
  cfg: unknown;
  accountId: string;
  account: ThenvoiAccountConfig;
  abortSignal: AbortSignal;
}

interface GatewayHelpers {
  startAccount: (ctx: GatewayContext) => Promise<void>;
  stopAccount: (ctx: GatewayContext) => Promise<void>;
}

interface ThreadingHelpers {
  extractThreadId: (message: OpenClawInboundMessage) => string;
  formatThreadContext?: (threadId: string) => string;
}

interface MessagingHelpers {
  normalizeTarget?: (raw: string) => string | undefined;
  targetResolver?: {
    looksLikeId?: (raw: string, normalized?: string) => boolean;
    hint?: string;
  };
}

interface PluginConfig {
  channels?: {
    thenvoi?: {
      accounts?: Record<string, ThenvoiAccountConfig>;
    };
    "openclaw-channel-thenvoi"?: {
      accounts?: Record<string, ThenvoiAccountConfig>;
    };
  };
  plugins?: {
    entries?: {
      thenvoi?: {
        config?: {
          accounts?: Record<string, ThenvoiAccountConfig>;
        };
      };
      "openclaw-channel-thenvoi"?: {
        config?: {
          accounts?: Record<string, ThenvoiAccountConfig>;
        };
      };
    };
  };
}

// =============================================================================
// Channel State
// =============================================================================

// Global registry to track gateway runtimes across module reloads
// This survives Jiti reloading the module
const GATEWAY_REGISTRY_KEY = "__thenvoi_gateway_registry__";
interface GatewayRegistry {
  runtimes: Map<string, ThenvoiRuntime>;
  clients: Map<string, ThenvoiClient>;
}

function getGatewayRegistry(): GatewayRegistry {
  const g = globalThis as unknown as Record<string, GatewayRegistry>;
  if (!g[GATEWAY_REGISTRY_KEY]) {
    g[GATEWAY_REGISTRY_KEY] = {
      runtimes: new Map(),
      clients: new Map(),
    };
  }
  return g[GATEWAY_REGISTRY_KEY];
}

// Active runtimes per account (use global registry)
const runtimes = getGatewayRegistry().runtimes;
const clients = getGatewayRegistry().clients;

// Track last sender per thread for auto-mention fallback
// Key: threadId, Value: { senderId, senderName }
const lastSenderByThread: Map<string, { senderId: string; senderName: string }> = new Map();

// Gateway callback for delivering inbound messages
let deliverInbound: ((message: OpenClawInboundMessage) => void) | null = null;

// OpenClaw runtime reference for message dispatch
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let openclawRuntime: any = null;

/**
 * Set the OpenClaw runtime reference for message dispatch.
 * Called by the plugin entry point.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setOpenClawRuntime(runtime: any): void {
  openclawRuntime = runtime;
  if (runtime?.channel?.reply) {
    console.log("[thenvoi] OpenClaw dispatch methods available");
  }
}

/**
 * Set the gateway callback for delivering inbound messages.
 * Called by OpenClaw when the channel is started.
 */
export function setInboundCallback(
  callback: (message: OpenClawInboundMessage) => void,
): void {
  deliverInbound = callback;
}

/**
 * Deliver an inbound message to OpenClaw.
 * Used by the service and runtime to send received messages to OpenClaw.
 */
export function deliverMessage(message: OpenClawInboundMessage): void {
  // Track the sender for auto-mention fallback when responding
  if (message.threadId && message.senderId && message.senderName) {
    lastSenderByThread.set(message.threadId, {
      senderId: message.senderId,
      senderName: message.senderName,
    });
  }

  if (deliverInbound) {
    deliverInbound(message);
  } else {
    console.warn("[thenvoi] Cannot deliver message: no inbound callback set");
  }
}

// =============================================================================
// Configuration Helpers
// =============================================================================

function resolveConfig(account: ThenvoiAccountConfig): ThenvoiConfig {
  const apiKey = account.apiKey ?? process.env.THENVOI_API_KEY;
  const agentId = account.agentId ?? process.env.THENVOI_AGENT_ID;
  const wsUrl = account.wsUrl ?? process.env.THENVOI_WS_URL ?? "wss://app.thenvoi.com/api/v1/socket";
  const restUrl = account.restUrl ?? process.env.THENVOI_REST_URL ?? "https://app.thenvoi.com";

  if (!apiKey) {
    throw new Error("THENVOI_API_KEY is required");
  }
  if (!agentId) {
    throw new Error("THENVOI_AGENT_ID is required");
  }

  return { apiKey, agentId, wsUrl, restUrl };
}

// =============================================================================
// Mention Resolution
// =============================================================================

/**
 * Find participants mentioned in text using @Name pattern.
 * Checks if "@<participant_name>" appears in the text for each participant.
 *
 * @param text - The message text to search
 * @param participants - List of room participants
 * @param agentId - Current agent's ID (excluded from results)
 * @returns Array of mentioned participants with id and name
 */
function findMentionedParticipants(
  text: string,
  participants: Array<{ id: string; name: string }>,
  agentId: string,
): MentionRequest[] {
  const mentioned: MentionRequest[] = [];
  for (const p of participants) {
    if (p.id !== agentId && text.includes(`@${p.name}`)) {
      mentioned.push({ id: p.id, name: p.name });
    }
  }
  return mentioned;
}

// =============================================================================
// Reply Helper
// =============================================================================

/**
 * Send a reply back to Thenvoi.
 * Used by the dispatcher when OpenClaw agent responds.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function sendReplyToThenvoi(client: ThenvoiClient, roomId: string, payload: any): Promise<void> {
  const text = typeof payload === "string" ? payload : payload?.text;
  if (!text) {
    console.warn("[thenvoi] No text in reply payload, skipping");
    return;
  }

  try {
    // Get participants for mention resolution
    const participants = await client.getParticipants(roomId);
    const agent = await client.getAgentMe();

    // Find participants mentioned in text via @Name pattern
    let mentions = findMentionedParticipants(text, participants, agent.id);

    // Fallback: prefer last sender, then any other participant
    if (mentions.length === 0) {
      const lastSender = lastSenderByThread.get(roomId);
      if (lastSender) {
        const senderParticipant = participants.find(
          (p) => p.id === lastSender.senderId && p.id !== agent.id
        );
        if (senderParticipant) {
          mentions = [{ id: senderParticipant.id, name: senderParticipant.name }];
        }
      }
    }

    if (mentions.length === 0) {
      const otherParticipant = participants.find((p) => p.id !== agent.id);
      if (!otherParticipant) {
        console.warn("[thenvoi] No participants to mention, skipping reply");
        return;
      }
      mentions = [{ id: otherParticipant.id, name: otherParticipant.name }];
    }

    await client.sendMessage(roomId, text, mentions);
    console.log(`[thenvoi] Reply sent: ${text.substring(0, 50)}...`);
  } catch (error) {
    console.error("[thenvoi] Failed to send reply:", error);
  }
}

// =============================================================================
// Channel Definition
// =============================================================================

export const thenvoiChannel: OpenClawChannel = {
  id: "openclaw-channel-thenvoi",

  meta: {
    id: "openclaw-channel-thenvoi",
    label: "Thenvoi",
    selectionLabel: "Thenvoi (AI Collaboration)",
    docsPath: "/channels/thenvoi",
    blurb: "Connect to the Thenvoi AI agent collaboration platform.",
    aliases: ["thenvoi", "openclaw-channel-thenvoi"],
  },

  capabilities: {
    chatTypes: ["direct", "group"],
    features: ["threading", "mentions"],
  },

  config: {
    listAccountIds: (config: PluginConfig): string[] => {
      // Check both plugin config and channels config (support both old "thenvoi" and new "openclaw-channel-thenvoi" keys)
      const pluginAccounts = config.plugins?.entries?.["openclaw-channel-thenvoi"]?.config?.accounts
        ?? config.plugins?.entries?.thenvoi?.config?.accounts ?? {};
      const channelAccounts = config.channels?.["openclaw-channel-thenvoi"]?.accounts
        ?? config.channels?.thenvoi?.accounts ?? {};
      const accounts = { ...pluginAccounts, ...channelAccounts };
      return Object.keys(accounts);
    },

    resolveAccount: (
      config: PluginConfig,
      accountId?: string,
    ): ThenvoiAccountConfig => {
      // Check both plugin config and channels config (support both old "thenvoi" and new "openclaw-channel-thenvoi" keys)
      const pluginAccounts = config.plugins?.entries?.["openclaw-channel-thenvoi"]?.config?.accounts
        ?? config.plugins?.entries?.thenvoi?.config?.accounts ?? {};
      const channelAccounts = config.channels?.["openclaw-channel-thenvoi"]?.accounts
        ?? config.channels?.thenvoi?.accounts ?? {};
      const accounts = { ...pluginAccounts, ...channelAccounts };
      const account = accounts[accountId ?? "default"] ?? { enabled: true };
      return account;
    },
  },

  outbound: {
    deliveryMode: "direct",

    resolveTarget: (params: { to?: string; allowFrom?: string[]; mode?: string }) => {
      console.log("[thenvoi] resolveTarget called with:", JSON.stringify(params));
      const target = params.to?.trim() ?? "";
      if (!target) {
        console.log("[thenvoi] resolveTarget: no target provided");
        return { ok: false, error: new Error("Thenvoi requires a room_id as target") };
      }
      console.log("[thenvoi] resolveTarget: accepting target:", target);
      return { ok: true, to: target };
    },

    sendText: async (ctx: OutboundContext): Promise<OutboundDeliveryResult> => {
      const { text, to, accountId } = ctx;
      // In Thenvoi, the target "to" is the room_id
      const roomId = to;

      console.log("[thenvoi] sendText called with:", JSON.stringify({ to, text: text.substring(0, 50), accountId }));

      if (!roomId) {
        throw new Error("room_id is required");
      }

      const client = clients.get(accountId ?? "default");
      if (!client) {
        throw new Error("Thenvoi client not initialized");
      }

      // Get participants for the room (needed for mention resolution and fallback)
      const participants = await client.getParticipants(roomId);
      const agent = await client.getAgentMe();

      // Find participants mentioned in text via @Name pattern
      let mentions: MentionRequest[] = findMentionedParticipants(text, participants, agent.id);

      // Fallback: prefer the last sender (the person we're replying to)
      if (mentions.length === 0) {
        const lastSender = lastSenderByThread.get(roomId);
        if (lastSender) {
          const senderParticipant = participants.find(
            (p) => p.id === lastSender.senderId && p.id !== agent.id
          );
          if (senderParticipant) {
            mentions = [{ id: senderParticipant.id, name: senderParticipant.name }];
          }
        }
      }

      // If still no mentions, fall back to first other participant
      if (mentions.length === 0) {
        const otherParticipant = participants.find((p) => p.id !== agent.id);
        if (!otherParticipant) {
          throw new Error("Cannot send message: no other participants to mention");
        }
        mentions = [{ id: otherParticipant.id, name: otherParticipant.name }];
      }

      const result = await client.sendMessage(roomId, text, mentions);
      console.log("[thenvoi] sendText result:", JSON.stringify(result));

      return {
        channel: "thenvoi",
        messageId: result?.id ?? `thenvoi-${Date.now()}`,
        roomId,
      };
    },

    sendMedia: async (ctx: OutboundContext): Promise<OutboundDeliveryResult> => {
      // Thenvoi doesn't support media yet - send as text with URL
      const { text, to, mediaUrl, accountId } = ctx;
      const roomId = to;

      console.log("[thenvoi] sendMedia called - converting to text with URL");

      if (!roomId) {
        throw new Error("room_id is required");
      }

      const client = clients.get(accountId ?? "default");
      if (!client) {
        throw new Error("Thenvoi client not initialized");
      }

      // Combine caption with media URL
      const messageText = mediaUrl ? `${text}\n\n${mediaUrl}` : text;

      // Get participants for mention
      const participants = await client.getParticipants(roomId);
      const agent = await client.getAgentMe();

      // Find participants mentioned in text via @Name pattern
      let mentions: MentionRequest[] = findMentionedParticipants(messageText, participants, agent.id);

      // Fallback: prefer the last sender
      if (mentions.length === 0) {
        const lastSender = lastSenderByThread.get(roomId);
        if (lastSender) {
          const senderParticipant = participants.find(
            (p) => p.id === lastSender.senderId && p.id !== agent.id
          );
          if (senderParticipant) {
            mentions = [{ id: senderParticipant.id, name: senderParticipant.name }];
          }
        }
      }

      if (mentions.length === 0) {
        const otherParticipant = participants.find((p) => p.id !== agent.id);
        if (!otherParticipant) {
          throw new Error("Cannot send message: no other participants to mention");
        }
        mentions = [{ id: otherParticipant.id, name: otherParticipant.name }];
      }

      const result = await client.sendMessage(roomId, messageText, mentions);

      return {
        channel: "thenvoi",
        messageId: result?.id ?? `thenvoi-${Date.now()}`,
        roomId,
      };
    },
  },

  setup: {
    validateConfig: async (
      config: ThenvoiAccountConfig,
    ): Promise<ValidationResult> => {
      try {
        const resolved = resolveConfig(config);

        // Test connection by fetching agent metadata
        const testClient = new ThenvoiClient(resolved);
        await testClient.getAgentMe();

        return { valid: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { valid: false, errors: [message] };
      }
    },
  },

  gateway: {
    startAccount: async (ctx: GatewayContext): Promise<void> => {
      const { accountId, account: accountConfig } = ctx;

      console.log(`[thenvoi:${accountId}] Starting gateway...`);

      // Disconnect any existing runtime to prevent orphaned connections on reload
      if (runtimes.has(accountId)) {
        console.log(`[thenvoi:${accountId}] Disconnecting previous runtime before restart...`);
        const existingRuntime = runtimes.get(accountId);
        if (existingRuntime) {
          await existingRuntime.disconnect();
        }
        runtimes.delete(accountId);
        clients.delete(accountId);
      }

      const config = resolveConfig(accountConfig);

      // Create REST client
      const client = new ThenvoiClient(config);
      clients.set(accountId, client);
      console.log(`[thenvoi:${accountId}] Client registered`);

      // Auto-approve callback for contact requests
      const autoApproveContacts = async (event: ContactEvent): Promise<void> => {
        if (event.type === "contact_request_received") {
          const payload = event.payload as ContactRequestReceivedPayload;
          console.log(
            `[thenvoi:${accountId}] Auto-approving contact request from ${payload.from_handle}`,
          );
          try {
            await client.respondContactRequest("approve", undefined, payload.id);
            console.log(
              `[thenvoi:${accountId}] Contact request ${payload.id} approved`,
            );
          } catch (error) {
            console.error(
              `[thenvoi:${accountId}] Failed to approve contact request:`,
              error,
            );
          }
        }
      };

      // Contact event handling config with auto-approve
      const contactConfig: ContactEventConfig = {
        strategy: "callback",
        onEvent: autoApproveContacts,
        broadcastChanges: true,
      };

      // Create and start runtime with client
      const runtime = new ThenvoiRuntime(
        config,
        {
          onMessage: async (message) => {
            // Track sender for auto-mention fallback
            if (message.threadId && message.senderId && message.senderName) {
              lastSenderByThread.set(message.threadId, {
                senderId: message.senderId,
                senderName: message.senderName,
              });
            }

            // Try OpenClaw dispatch first
            if (openclawRuntime?.channel?.reply?.dispatchReplyFromConfig) {
              try {
                // Format the inbound context matching OpenClaw's FinalizedMsgContext
                const inboundCtx = {
                  Body: message.text,
                  RawBody: message.text,
                  BodyForCommands: message.text,
                  CommandBody: message.text,
                  From: message.senderId,
                  SenderId: message.senderId,
                  SenderName: message.senderName,
                  To: message.threadId,
                  SessionKey: `thenvoi:${message.threadId}`,
                  Surface: "thenvoi",
                  Provider: "thenvoi",
                  MessageSid: message.metadata?.messageId,
                  Timestamp: message.timestamp ? new Date(message.timestamp).getTime() : Date.now(),
                  ChatType: "group",
                  CommandAuthorized: true,
                };

                // Create a dispatcher that sends replies via Thenvoi
                const dispatcher = {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  sendToolResult: (payload: any): boolean => {
                    void sendReplyToThenvoi(client, message.threadId, payload);
                    return true;
                  },
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  sendBlockReply: (payload: any): boolean => {
                    void sendReplyToThenvoi(client, message.threadId, payload);
                    return true;
                  },
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  sendFinalReply: (payload: any): boolean => {
                    void sendReplyToThenvoi(client, message.threadId, payload);
                    return true;
                  },
                  waitForIdle: async (): Promise<void> => Promise.resolve(),
                  getQueuedCounts: () => ({ tool: 0, block: 0, final: 0 }),
                };

                console.log(`[thenvoi:${accountId}] Dispatching message to OpenClaw agent...`);
                const cfg = openclawRuntime.config.loadConfig();
                await openclawRuntime.channel.reply.dispatchReplyFromConfig({
                  ctx: inboundCtx,
                  cfg,
                  dispatcher,
                });
                console.log(`[thenvoi:${accountId}] Message dispatched successfully`);
              } catch (error) {
                console.error(`[thenvoi:${accountId}] Failed to dispatch message:`, error);
              }
            } else if (deliverInbound) {
              // Fallback to legacy callback
              deliverInbound(message);
            } else {
              console.warn(`[thenvoi:${accountId}] No dispatch method available for inbound message`);
            }
          },
          onRoomJoined: (roomId, title) => {
            console.log(`[thenvoi:${accountId}] Joined room: ${title} (${roomId})`);
          },
          onRoomLeft: (roomId) => {
            console.log(`[thenvoi:${accountId}] Left room: ${roomId}`);
          },
          onError: (error) => {
            console.error(`[thenvoi:${accountId}] Error:`, error.message);
          },
          // Reconnection callbacks
          onReconnecting: (attempt, delayMs) => {
            console.log(
              `[thenvoi:${accountId}] Reconnecting (attempt ${attempt}) in ${delayMs}ms`,
            );
          },
          onReconnected: () => {
            console.log(`[thenvoi:${accountId}] Reconnected successfully`);
          },
          // Sync callbacks
          onSyncStarted: () => {
            console.log(`[thenvoi:${accountId}] Starting message sync`);
          },
          onSyncCompleted: (count) => {
            console.log(
              `[thenvoi:${accountId}] Sync complete, processed ${count} messages`,
            );
          },
          onSyncError: (error) => {
            console.error(`[thenvoi:${accountId}] Sync error:`, error.message);
          },
        },
        client,
        contactConfig,
      );

      await runtime.connect();
      runtimes.set(accountId, runtime);

      console.log(`[thenvoi:${accountId}] Connected to Thenvoi platform`);
    },

    stopAccount: async (ctx: GatewayContext): Promise<void> => {
      const { accountId } = ctx;
      const runtime = runtimes.get(accountId);
      if (runtime) {
        await runtime.disconnect();
        runtimes.delete(accountId);
      }

      clients.delete(accountId);

      console.log(`[thenvoi:${accountId}] Disconnected from Thenvoi platform`);
    },
  },

  threading: {
    extractThreadId: (message: OpenClawInboundMessage): string => {
      return message.threadId;
    },

    formatThreadContext: (threadId: string): string => {
      return `[Thenvoi Room: ${threadId}]`;
    },
  },

  messaging: {
    targetResolver: {
      // UUID pattern for Thenvoi room IDs
      looksLikeId: (raw: string): boolean => {
        const trimmed = raw.trim();
        // Match UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const isUuid = uuidPattern.test(trimmed);
        console.log(`[thenvoi] looksLikeId("${trimmed}") = ${isUuid}`);
        return isUuid;
      },
      hint: "Provide a Thenvoi room_id (UUID format)",
    },
  },
};

// =============================================================================
// Plugin Registration
// =============================================================================

/**
 * Register the Thenvoi channel with OpenClaw.
 */
export function registerChannel(api: OpenClawChannelApi): void {
  console.log("[thenvoi] Registering channel with OpenClaw...");
  console.log("[thenvoi] Channel definition:", JSON.stringify({
    id: thenvoiChannel.id,
    meta: thenvoiChannel.meta,
    capabilities: thenvoiChannel.capabilities,
    hasGateway: !!thenvoiChannel.gateway,
    hasOutbound: !!thenvoiChannel.outbound,
    hasMessaging: !!thenvoiChannel.messaging,
    hasLooksLikeId: !!thenvoiChannel.messaging?.targetResolver?.looksLikeId,
  }, null, 2));
  api.registerChannel({ plugin: thenvoiChannel });
  console.log("[thenvoi] Channel registered successfully");
}

// =============================================================================
// Utility Exports (for MCP tools)
// =============================================================================

/**
 * Get the REST client for an account.
 */
export function getClient(accountId: string = "default"): ThenvoiClient | undefined {
  return clients.get(accountId);
}

/**
 * Get the runtime for an account.
 */
export function getRuntime(accountId: string = "default"): ThenvoiRuntime | undefined {
  return runtimes.get(accountId);
}

/**
 * Get the current agent's ID (UUID).
 */
export function getAgentId(accountId: string = "default"): string | undefined {
  return runtimes.get(accountId)?.agentId;
}
