/**
 * Thenvoi Channel Plugin for OpenClaw.
 *
 * Registers the Thenvoi channel with OpenClaw Gateway,
 * enabling bidirectional communication with the Thenvoi platform.
 *
 * Uses @thenvoi/sdk for all platform communication (WebSocket + REST).
 */

import { ThenvoiLink } from "@thenvoi/sdk";
import { RoomPresence, ContactEventHandler } from "@thenvoi/sdk/runtime";
import type { RestApi } from "@thenvoi/sdk/rest";
import type { ContactEventConfig, ContactEvent, PlatformEvent } from "@thenvoi/sdk";

// SDK types used internally but not exported from entry points — define structurally
interface MentionReference {
  id: string;
  name?: string;
  handle?: string;
}

// =============================================================================
// OpenClaw-Specific Types
// =============================================================================

export interface ThenvoiAccountConfig {
  enabled?: boolean;
  apiKey?: string;
  agentId?: string;
  wsUrl?: string;
  restUrl?: string;
  stateDir?: string;
  contactConfig?: ContactEventConfig;
}

export interface OpenClawInboundMessage {
  channelId: "thenvoi";
  threadId: string;
  senderId: string;
  senderType: string;
  senderName: string;
  text: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

interface ThenvoiConfig {
  apiKey: string;
  agentId: string;
  wsUrl: string;
  restUrl: string;
}

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
// Virtual thread ID for contact events (dispatched to LLM for evaluation)
// =============================================================================

const CONTACTS_THREAD_ID = "__thenvoi_contacts__";

// =============================================================================
// Channel State
// =============================================================================

// Global registry to track gateway connections across module reloads
// This survives Jiti reloading the module
const GATEWAY_REGISTRY_KEY = "__thenvoi_gateway_registry__";
interface GatewayRegistry {
  links: Map<string, ThenvoiLink>;
  presences: Map<string, RoomPresence>;
}

function getGatewayRegistry(): GatewayRegistry {
  const g = globalThis as unknown as Record<string, GatewayRegistry>;
  if (!g[GATEWAY_REGISTRY_KEY]) {
    g[GATEWAY_REGISTRY_KEY] = {
      links: new Map(),
      presences: new Map(),
    };
  }
  return g[GATEWAY_REGISTRY_KEY];
}

// Active connections per account (use global registry)
const links = getGatewayRegistry().links;
const presences = getGatewayRegistry().presences;

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
 */
function findMentionedParticipants(
  text: string,
  participants: Array<{ id: string; name: string }>,
  agentId: string,
): MentionReference[] {
  const mentioned: MentionReference[] = [];
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
 * Send a reply back to Thenvoi using the SDK's REST API.
 */
async function sendReplyToThenvoi(rest: RestApi, roomId: string, payload: unknown): Promise<void> {
  const text = typeof payload === "string" ? payload : (payload as { text?: string })?.text;
  if (!text) {
    console.warn("[thenvoi] No text in reply payload, skipping");
    return;
  }

  try {
    // Get participants for mention resolution
    const participants = await rest.listChatParticipants(roomId);
    const agent = await rest.getAgentMe();

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

    await rest.createChatMessage(roomId, { content: text, mentions });
    console.log(`[thenvoi] Reply sent: ${text.substring(0, 50)}...`);
  } catch (error) {
    console.error("[thenvoi] Failed to send reply:", error);
  }
}

// =============================================================================
// Event to Message Conversion
// =============================================================================

/**
 * Convert a SDK PlatformEvent (message_created) to OpenClawInboundMessage.
 */
function platformEventToInboundMessage(event: PlatformEvent): OpenClawInboundMessage | null {
  if (event.type !== "message_created") return null;
  const payload = event.payload;
  const roomId = event.roomId ?? payload.chat_room_id;
  if (!roomId) return null;

  // Only process text messages, not events
  if (payload.message_type !== "text") return null;

  return {
    channelId: "thenvoi",
    threadId: roomId,
    senderId: payload.sender_id,
    senderType: payload.sender_type,
    senderName: payload.sender_name ?? "Unknown",
    text: payload.content,
    timestamp: payload.inserted_at,
    metadata: {
      messageId: payload.id,
      messageType: payload.message_type,
      mentions: payload.metadata?.mentions,
    },
  };
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
      const roomId = to;

      console.log("[thenvoi] sendText called with:", JSON.stringify({ to, text: text.substring(0, 50), accountId }));

      if (!roomId) {
        throw new Error("room_id is required");
      }

      const link = links.get(accountId ?? "default");
      if (!link) {
        throw new Error("Thenvoi link not initialized");
      }
      const rest = link.rest;

      // Get participants for mention resolution
      const participants = await rest.listChatParticipants(roomId);
      const agent = await rest.getAgentMe();

      let mentions: MentionReference[] = findMentionedParticipants(text, participants, agent.id);

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

      if (mentions.length === 0) {
        const otherParticipant = participants.find((p) => p.id !== agent.id);
        if (!otherParticipant) {
          throw new Error("Cannot send message: no other participants to mention");
        }
        mentions = [{ id: otherParticipant.id, name: otherParticipant.name }];
      }

      const result = await rest.createChatMessage(roomId, { content: text, mentions });
      console.log("[thenvoi] sendText result:", JSON.stringify(result));

      return {
        channel: "thenvoi",
        messageId: (result as Record<string, unknown>).id as string ?? `thenvoi-${Date.now()}`,
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

      const link = links.get(accountId ?? "default");
      if (!link) {
        throw new Error("Thenvoi link not initialized");
      }
      const rest = link.rest;

      const messageText = mediaUrl ? `${text}\n\n${mediaUrl}` : text;

      const participants = await rest.listChatParticipants(roomId);
      const agent = await rest.getAgentMe();

      let mentions: MentionReference[] = findMentionedParticipants(messageText, participants, agent.id);

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

      const result = await rest.createChatMessage(roomId, { content: messageText, mentions });

      return {
        channel: "thenvoi",
        messageId: (result as Record<string, unknown>).id as string ?? `thenvoi-${Date.now()}`,
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

        // Test connection by creating a temporary link and fetching agent metadata
        const testLink = new ThenvoiLink({
          agentId: resolved.agentId,
          apiKey: resolved.apiKey,
          wsUrl: resolved.wsUrl,
          restUrl: resolved.restUrl,
        });
        await testLink.rest.getAgentMe();

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

      // Disconnect any existing connection to prevent orphaned connections on reload
      if (links.has(accountId)) {
        console.log(`[thenvoi:${accountId}] Disconnecting previous connection before restart...`);
        const existingPresence = presences.get(accountId);
        if (existingPresence) {
          await existingPresence.stop();
          presences.delete(accountId);
        }
        const existingLink = links.get(accountId);
        if (existingLink) {
          await existingLink.disconnect();
        }
        links.delete(accountId);
      }

      const config = resolveConfig(accountConfig);

      // Create ThenvoiLink (combines WebSocket + REST)
      const link = new ThenvoiLink({
        agentId: config.agentId,
        apiKey: config.apiKey,
        wsUrl: config.wsUrl,
        restUrl: config.restUrl,
      });
      links.set(accountId, link);
      console.log(`[thenvoi:${accountId}] Link created`);

      // Connect WebSocket
      await link.connect();
      console.log(`[thenvoi:${accountId}] WebSocket connected`);

      // Create RoomPresence for automatic room subscription management
      const presence = new RoomPresence({
        link,
        autoSubscribeExistingRooms: true,
      });

      // Set up room event handlers
      presence.onRoomJoined = async (roomId: string, payload: Record<string, unknown>) => {
        const title = (payload.title as string) ?? roomId;
        console.log(`[thenvoi:${accountId}] Joined room: ${title} (${roomId})`);
      };

      presence.onRoomLeft = async (roomId: string) => {
        console.log(`[thenvoi:${accountId}] Left room: ${roomId}`);
      };

      // Handle room events (messages, participant changes)
      presence.onRoomEvent = async (_roomId: string, event: PlatformEvent) => {
        // Only process message_created events
        if (event.type !== "message_created") return;

        // Skip messages from our own agent
        if (event.payload.sender_id === config.agentId) return;

        const message = platformEventToInboundMessage(event);
        if (!message) return;

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
              MessageSid: (message.metadata as Record<string, unknown>)?.messageId,
              Timestamp: message.timestamp ? new Date(message.timestamp).getTime() : Date.now(),
              ChatType: "group",
              CommandAuthorized: true,
            };

            // Contact events use a virtual thread — don't try to send to Thenvoi
            const isContactThread = message.threadId === CONTACTS_THREAD_ID;
            const dispatcher = {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              sendToolResult: (payload: any): boolean => {
                if (!isContactThread) void sendReplyToThenvoi(link.rest, message.threadId, payload);
                return true;
              },
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              sendBlockReply: (payload: any): boolean => {
                if (!isContactThread) void sendReplyToThenvoi(link.rest, message.threadId, payload);
                return true;
              },
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              sendFinalReply: (payload: any): boolean => {
                if (!isContactThread) void sendReplyToThenvoi(link.rest, message.threadId, payload);
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
          deliverInbound(message);
        } else {
          console.warn(`[thenvoi:${accountId}] No dispatch method available for inbound message`);
        }

        // Mark message as processed
        const messageId = event.payload.id;
        const roomId = event.roomId ?? event.payload.chat_room_id;
        if (roomId && messageId) {
          try {
            await link.markProcessed(roomId, messageId, { bestEffort: true });
          } catch {
            // Best effort - don't fail if marking fails
          }
        }
      };

      // Handle contact events
      presence.onContactEvent = async (event: ContactEvent) => {
        console.log(`[thenvoi:${accountId}] Contact event: ${event.type}`);
        // Contact events are dispatched through the room event handler
        // by creating a synthetic inbound message for the contacts thread
        const contactHandler = new ContactEventHandler({
          config: { strategy: "hub_room", broadcastChanges: true },
          rest: link.rest,
          onBroadcast: (msg: string) => {
            console.log(`[thenvoi:${accountId}] Contact broadcast: ${msg}`);
          },
        });
        await contactHandler.handle(event);
      };

      presences.set(accountId, presence);

      // Start the event loop
      await presence.start();

      console.log(`[thenvoi:${accountId}] Connected to Thenvoi platform`);
    },

    stopAccount: async (ctx: GatewayContext): Promise<void> => {
      const { accountId } = ctx;

      const presence = presences.get(accountId);
      if (presence) {
        await presence.stop();
        presences.delete(accountId);
      }

      const link = links.get(accountId);
      if (link) {
        await link.disconnect();
        links.delete(accountId);
      }

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
 * Get the ThenvoiLink for an account.
 */
export function getLink(accountId: string = "default"): ThenvoiLink | undefined {
  return links.get(accountId);
}

/**
 * Get the current agent's ID (UUID).
 */
export function getAgentId(accountId: string = "default"): string | undefined {
  return links.get(accountId)?.agentId;
}
