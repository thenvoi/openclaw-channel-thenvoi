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
import type { ContactEventConfig, ContactEvent, PlatformEvent } from "@thenvoi/sdk";

// =============================================================================
// OpenClaw-Specific Types
// =============================================================================

export interface ThenvoiAccountConfig {
  enabled?: boolean;
  apiKey?: string;
  agentId?: string;
  wsUrl?: string;
  restUrl?: string;
  contactConfig?: ContactEventConfig;
}

export type SenderType = "User" | "Agent" | "System";

export interface OpenClawInboundMessage {
  channelId: "thenvoi";
  threadId: string;
  senderId: string;
  senderType: SenderType;
  senderName: string;
  text: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
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
// Minimal type for the OpenClaw runtime methods we access
// =============================================================================

interface OpenClawRuntimeRef {
  channel?: {
    reply?: {
      dispatchReplyFromConfig?: (args: {
        ctx: Record<string, unknown>;
        cfg: unknown;
        dispatcher: Record<string, unknown>;
      }) => Promise<void>;
    };
  };
  config?: {
    loadConfig: () => unknown;
  };
}

// =============================================================================
// Virtual thread ID for contact events (dispatched to LLM for evaluation)
// =============================================================================

export const CONTACTS_THREAD_ID = "__thenvoi_contacts__";

// =============================================================================
// Channel State
// =============================================================================

// Global registry to track gateway state across module reloads.
// All mutable state lives here so it survives Jiti reloading the module.
// The key is versioned so that two different package versions loaded in
// the same process do not silently share (and corrupt) each other's state.
//
// __OPENCLAW_PKG_VERSION__ is replaced at build time by tsup (see tsup.config.ts `define`).
// At dev/test time it falls back to reading package.json so the version is
// never hardcoded in source.
declare const __OPENCLAW_PKG_VERSION__: string;
function resolvePackageVersion(): string {
  if (typeof __OPENCLAW_PKG_VERSION__ !== "undefined") return __OPENCLAW_PKG_VERSION__;
  try {
    // Dev / test fallback: read from package.json via Node's fs
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { fileURLToPath } = require("node:url") as typeof import("node:url");
    const pkgPath = new URL("../package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync(fileURLToPath(pkgPath), "utf-8")) as { version: string };
    return pkg.version;
  } catch {
    return "0.0.0-dev";
  }
}
const PKG_VERSION: string = resolvePackageVersion();
const GATEWAY_REGISTRY_KEY = `__thenvoi_gateway_registry_v${PKG_VERSION}__`;
interface GatewayRegistry {
  links: Map<string, ThenvoiLink>;
  presences: Map<string, RoomPresence>;
  roomToAccount: Map<string, string>;
  startingAccounts: Set<string>;
  lastSenderByThread: Map<string, { senderId: string; senderName: string }>;
  participantCache: Map<string, { participants: Array<{ id: string; name: string }>; expiresAt: number }>;
  deliverInbound: ((message: OpenClawInboundMessage) => void) | null;
  openclawRuntime: OpenClawRuntimeRef | null;
}

function getGatewayRegistry(): GatewayRegistry {
  const g = globalThis as unknown as Record<string, GatewayRegistry>;
  if (!g[GATEWAY_REGISTRY_KEY]) {
    g[GATEWAY_REGISTRY_KEY] = {
      links: new Map(),
      presences: new Map(),
      roomToAccount: new Map(),
      startingAccounts: new Set(),
      lastSenderByThread: new Map(),
      participantCache: new Map(),
      deliverInbound: null,
      openclawRuntime: null,
    };
  }
  return g[GATEWAY_REGISTRY_KEY];
}

/**
 * Reset the gateway registry to its initial state.
 * Intended for test isolation — call in beforeEach/afterEach to prevent state leaking between tests.
 */
export function resetGatewayRegistry(): void {
  const g = globalThis as unknown as Record<string, GatewayRegistry>;
  delete g[GATEWAY_REGISTRY_KEY];
}

// Convenience accessors that always read from the current registry.
// These MUST be functions (not module-level consts) so that
// resetGatewayRegistry() properly invalidates cached state.
function registry() { return getGatewayRegistry(); }
function links() { return getGatewayRegistry().links; }
function presences() { return getGatewayRegistry().presences; }

// Track last sender per thread for auto-mention fallback
// Key: threadId, Value: { senderId, senderName }
const MAX_SENDER_CACHE = 500;

function trackSender(accountId: string, threadId: string, senderId: string, senderName: string): void {
  const lastSenderByThread = registry().lastSenderByThread;
  const cacheKey = `${accountId}:${threadId}`;
  // Delete-and-reinsert to move the entry to the end (LRU eviction order)
  lastSenderByThread.delete(cacheKey);
  if (lastSenderByThread.size >= MAX_SENDER_CACHE) {
    // Evict least-recently-used entry (first key in Map insertion order)
    const oldest = lastSenderByThread.keys().next().value;
    if (oldest) lastSenderByThread.delete(oldest);
  }
  lastSenderByThread.set(cacheKey, { senderId, senderName });
}

/**
 * Check if a value has the shape of an OpenClawRuntimeRef.
 */
function isOpenClawRuntimeRef(value: unknown): value is OpenClawRuntimeRef {
  if (value == null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;

  const hasLoadConfig =
    obj.config != null &&
    typeof obj.config === "object" &&
    typeof (obj.config as Record<string, unknown>).loadConfig === "function";

  const hasDispatch =
    obj.channel != null &&
    typeof obj.channel === "object" &&
    (obj.channel as Record<string, unknown>).reply != null &&
    typeof (obj.channel as Record<string, unknown>).reply === "object" &&
    typeof ((obj.channel as Record<string, unknown>).reply as Record<string, unknown>).dispatchReplyFromConfig === "function";

  if (hasLoadConfig || hasDispatch) {
    if (hasLoadConfig && !hasDispatch) {
      console.warn("[thenvoi] Runtime has config.loadConfig but missing channel.reply.dispatchReplyFromConfig — message dispatch will fall back to deliverMessage");
    }
    return true;
  }
  return false;
}

/**
 * Set the OpenClaw runtime reference for message dispatch.
 * Called by the plugin entry point.
 */
export function setOpenClawRuntime(runtime: unknown): void {
  if (!isOpenClawRuntimeRef(runtime)) {
    console.warn("[thenvoi] setOpenClawRuntime called with invalid runtime object, ignoring");
    return;
  }
  registry().openclawRuntime = runtime;
  if (runtime.channel?.reply) {
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
  registry().deliverInbound = callback;
}

/**
 * Deliver an inbound message to OpenClaw.
 * Used by the service and runtime to send received messages to OpenClaw.
 */
export function deliverMessage(message: OpenClawInboundMessage, accountId: string = "default"): void {
  // Track the sender for auto-mention fallback when responding
  if (message.threadId && message.senderId && message.senderName) {
    trackSender(accountId, message.threadId, message.senderId, message.senderName);
  }

  const deliver = registry().deliverInbound;
  if (deliver) {
    deliver(message);
  } else {
    console.warn("[thenvoi] Cannot deliver message: no inbound callback set");
  }
}

// =============================================================================
// Configuration Helpers
// =============================================================================

function resolveConfig(account: ThenvoiAccountConfig): { apiKey: string; agentId: string; wsUrl: string; restUrl: string } {
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

  // apiKey and agentId are guaranteed non-empty after the checks above,
  // but ?? narrows to `string | undefined` — assert for the return type.
  return { apiKey: apiKey as string, agentId: agentId as string, wsUrl, restUrl };
}

// =============================================================================
// Mention Resolution
// =============================================================================

type Mention = { id: string; name?: string };

// Per-room participant cache with 5-second TTL to avoid hitting the REST API
// on every outbound message in rapid back-and-forth conversations.
const PARTICIPANT_CACHE_TTL_MS = 5_000;

async function getCachedParticipants(
  rest: ThenvoiLink["rest"],
  roomId: string,
): Promise<Array<{ id: string; name: string }>> {
  const cache = registry().participantCache;
  const cached = cache.get(roomId);
  if (cached && cached.expiresAt > Date.now()) return cached.participants;
  const participants = await rest.listChatParticipants(roomId);
  cache.set(roomId, { participants, expiresAt: Date.now() + PARTICIPANT_CACHE_TTL_MS });
  return participants;
}

/**
 * Resolve mentions for a message: find @Name in text, fall back to last sender, then any participant.
 * Returns null if no participants are available to mention (caller decides how to handle).
 */
async function resolveMentions(
  rest: ThenvoiLink["rest"],
  agentId: string,
  accountId: string,
  roomId: string,
  text: string,
): Promise<{ mentions: Mention[]; participants: Array<{ id: string; name: string }> } | null> {
  const participants = await getCachedParticipants(rest, roomId);

  // 1. Explicit @Name mentions in text (case-insensitive, word-boundary matching)
  const mentioned: Mention[] = [];
  const textLower = text.toLowerCase();
  for (const p of participants) {
    if (p.id !== agentId) {
      const nameEscaped = p.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const nameRegex = new RegExp(`@${nameEscaped}(?:\\b|$)`, "i");
      if (nameRegex.test(textLower)) {
        mentioned.push({ id: p.id, name: p.name });
      }
    }
  }
  if (mentioned.length > 0) return { mentions: mentioned, participants };

  // 2. Fallback: last sender in this thread
  const lastSender = registry().lastSenderByThread.get(`${accountId}:${roomId}`);
  if (lastSender) {
    const senderParticipant = participants.find(
      (p) => p.id === lastSender.senderId && p.id !== agentId
    );
    if (senderParticipant) {
      return { mentions: [{ id: senderParticipant.id, name: senderParticipant.name }], participants };
    }
  }

  // 3. Fallback: first other participant
  const other = participants.find((p) => p.id !== agentId);
  if (other) {
    return { mentions: [{ id: other.id, name: other.name }], participants };
  }

  return null;
}

// =============================================================================
// Reply Helper
// =============================================================================

/**
 * Send a reply back to Thenvoi using the SDK's REST API.
 * Throws on failure so callers (e.g. the dispatcher) can track and surface delivery errors.
 */
async function sendReplyToThenvoi(rest: ThenvoiLink["rest"], agentId: string, accountId: string, roomId: string, payload: unknown): Promise<void> {
  let text: string | undefined;
  if (typeof payload === "string") {
    text = payload;
  } else if (payload != null && typeof payload === "object" && "text" in payload) {
    text = (payload as { text?: string }).text;
  } else {
    console.warn(`[thenvoi] Unexpected reply payload shape (room=${roomId}):`, typeof payload);
  }
  if (!text) {
    throw new Error(`[thenvoi] No text in reply payload (room=${roomId})`);
  }

  const resolved = await resolveMentions(rest, agentId, accountId, roomId, text);
  if (!resolved) {
    throw new Error(
      `[thenvoi] Reply dropped: no other participants in room to mention (room=${roomId}, text=${text.substring(0, 80)})`,
    );
  }
  await rest.createChatMessage(roomId, { content: text, mentions: resolved.mentions });
  console.log(`[thenvoi] Reply sent: ${text.length > 50 ? text.substring(0, 50) + "..." : text}`);
}

// =============================================================================
// Dispatch Helpers
// =============================================================================

/**
 * Build the inbound context object that OpenClaw's dispatchReplyFromConfig expects.
 */
function buildInboundCtx(message: OpenClawInboundMessage): Record<string, unknown> {
  return {
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
}

/**
 * Create a no-op dispatcher for threads that don't send replies (e.g. contact events).
 */
function createNoopDispatcher() {
  const noopSend = (): boolean => true;
  return {
    sendToolResult: noopSend,
    sendBlockReply: noopSend,
    sendFinalReply: noopSend,
    waitForIdle: async (): Promise<void> => {},
    getQueuedCounts: () => ({ tool: 0, block: 0, final: 0 }),
  };
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
  if (payload.message_type !== "text") {
    console.log(`[thenvoi] Skipping non-text message (type=${payload.message_type}, room=${roomId})`);
    return null;
  }

  return {
    channelId: "thenvoi",
    threadId: roomId,
    senderId: payload.sender_id,
    senderType: payload.sender_type as SenderType,
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
// Outbound Send Helper
// =============================================================================

/**
 * Shared logic for sending an outbound message (text or media) to Thenvoi.
 */
async function sendOutbound(ctx: OutboundContext): Promise<OutboundDeliveryResult> {
  const { text, to, accountId } = ctx;
  const roomId = to;

  if (!roomId) {
    throw new Error("room_id is required");
  }

  const link = links().get(accountId ?? "default");
  if (!link) {
    throw new Error("Thenvoi link not initialized");
  }

  const resolved = await resolveMentions(link.rest, link.agentId, accountId ?? "default", roomId, text);
  if (!resolved) {
    throw new Error("Cannot send message: no other participants to mention");
  }

  const result = await link.rest.createChatMessage(roomId, { content: text, mentions: resolved.mentions });

  return {
    channel: "thenvoi",
    messageId: String(result.id ?? `thenvoi-${Date.now()}`),
    roomId,
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
      const target = params.to?.trim() ?? "";
      if (!target) {
        return { ok: false, error: new Error("Thenvoi requires a room_id as target") };
      }
      return { ok: true, to: target };
    },

    sendText: (ctx: OutboundContext): Promise<OutboundDeliveryResult> => {
      return sendOutbound(ctx);
    },

    sendMedia: (ctx: OutboundContext): Promise<OutboundDeliveryResult> => {
      const messageText = ctx.mediaUrl ? `${ctx.text}\n\n${ctx.mediaUrl}` : ctx.text;
      return sendOutbound({ ...ctx, text: messageText });
    },
  },

  setup: {
    validateConfig: async (
      config: ThenvoiAccountConfig,
    ): Promise<ValidationResult> => {
      let testLink: ThenvoiLink | null = null;
      try {
        const resolved = resolveConfig(config);

        // Test connection by creating a temporary link and fetching agent metadata
        testLink = new ThenvoiLink({
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
      } finally {
        if (testLink) {
          try { await testLink.disconnect(); } catch { /* ignore cleanup errors */ }
        }
      }
    },
  },

  gateway: {
    startAccount: async (ctx: GatewayContext): Promise<void> => {
      const { accountId, account: accountConfig } = ctx;

      // Prevent concurrent startAccount calls for the same account
      if (registry().startingAccounts.has(accountId)) {
        console.warn(`[thenvoi:${accountId}] startAccount already in progress, skipping`);
        return;
      }
      registry().startingAccounts.add(accountId);

      try {
        console.log(`[thenvoi:${accountId}] Starting gateway...`);

        // Disconnect any existing connection to prevent orphaned connections on reload
        if (links().has(accountId)) {
          console.log(`[thenvoi:${accountId}] Disconnecting previous connection before restart...`);
          const existingPresence = presences().get(accountId);
          if (existingPresence) {
            await existingPresence.stop();
            presences().delete(accountId);
          }
          const existingLink = links().get(accountId);
          if (existingLink) {
            await existingLink.disconnect();
          }
          links().delete(accountId);
        }

        const config = resolveConfig(accountConfig);

        // Create ThenvoiLink (combines WebSocket + REST)
        const link = new ThenvoiLink({
          agentId: config.agentId,
          apiKey: config.apiKey,
          wsUrl: config.wsUrl,
          restUrl: config.restUrl,
        });
        links().set(accountId, link);
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
          registry().roomToAccount.set(roomId, accountId);
          console.log(`[thenvoi:${accountId}] Joined room: ${title} (${roomId})`);
        };

        presence.onRoomLeft = async (roomId: string) => {
          registry().roomToAccount.delete(roomId);
          console.log(`[thenvoi:${accountId}] Left room: ${roomId}`);
        };

        // Handle room events (messages, participant changes)
        presence.onRoomEvent = async (_roomId: string, event: PlatformEvent) => {
          // Invalidate participant cache when membership changes
          if (event.type === "participant_added" || event.type === "participant_removed") {
            const fallbackId = event.payload != null && typeof event.payload === "object" && "chat_room_id" in event.payload
              ? String((event.payload as Record<string, unknown>).chat_room_id)
              : undefined;
            const roomId = event.roomId ?? fallbackId;
            if (roomId) registry().participantCache.delete(roomId);
            return;
          }

          // Only process message_created events
          if (event.type !== "message_created") return;

          // Skip messages from our own agent
          if (event.payload.sender_id === config.agentId) return;

          const message = platformEventToInboundMessage(event);
          if (!message) return;

          // Try OpenClaw dispatch first
          const rt = registry().openclawRuntime;
          const dispatchFn = rt?.channel?.reply?.dispatchReplyFromConfig;
          let dispatchSucceeded = false;
          if (rt?.config && dispatchFn) {
            try {
              // Track sender before dispatch — needed for auto-mention fallback
              // in sendReplyToThenvoi (deliverMessage owns tracking for the other path)
              if (message.threadId && message.senderId && message.senderName) {
                trackSender(accountId, message.threadId, message.senderId, message.senderName);
              }

              const inboundCtx = buildInboundCtx(message);

              // Contact events use a virtual thread — don't try to send to Thenvoi
              const isContactThread = message.threadId === CONTACTS_THREAD_ID;

              const threadId = message.threadId;

              const dispatcher = isContactThread
                ? createNoopDispatcher()
                : (() => {
                    // Track pending reply promises so waitForIdle can await them
                    const pendingReplies: Promise<void>[] = [];
                    const deliveryErrors: Error[] = [];

                    function enqueueReply(payload: unknown): void {
                      pendingReplies.push(
                        sendReplyToThenvoi(link.rest, config.agentId, accountId, threadId, payload).catch((err: unknown) => {
                          const error = err instanceof Error ? err : new Error(String(err));
                          deliveryErrors.push(error);
                          console.error(`[thenvoi:${accountId}] Reply delivery failed (room=${threadId}):`, error.message);
                        }),
                      );
                    }

                    return {
                      sendToolResult: (payload: unknown): boolean => { enqueueReply(payload); return true; },
                      sendBlockReply: (payload: unknown): boolean => { enqueueReply(payload); return true; },
                      sendFinalReply: (payload: unknown): boolean => { enqueueReply(payload); return true; },
                      waitForIdle: async (): Promise<void> => {
                        await Promise.allSettled(pendingReplies);
                        if (deliveryErrors.length > 0) {
                          const summary = deliveryErrors.map((e) => e.message).join("; ");
                          const errorMsg = `[thenvoi:${accountId}] ${deliveryErrors.length}/${pendingReplies.length} replies failed to deliver (room=${message.threadId}): ${summary}`;
                          console.error(errorMsg);
                          throw new AggregateError(deliveryErrors, errorMsg);
                        }
                      },
                      getQueuedCounts: () => ({ tool: 0, block: 0, final: 0 }),
                    };
                  })();

              console.log(`[thenvoi:${accountId}] Dispatching message to OpenClaw agent...`);
              const cfg = rt.config.loadConfig();
              await dispatchFn({
                ctx: inboundCtx,
                cfg,
                dispatcher,
              });
              // Await any pending reply deliveries and surface errors
              await dispatcher.waitForIdle();
              console.log(`[thenvoi:${accountId}] Message dispatched successfully`);
              dispatchSucceeded = true;
            } catch (error) {
              console.error(`[thenvoi:${accountId}] Failed to dispatch message:`, error);
            }
          } else {
            // deliverMessage handles sender tracking and warns if no callback is set
            deliverMessage(message, accountId);
            dispatchSucceeded = true;
          }

          // Only mark as processed if dispatch succeeded — failed messages
          // should remain unprocessed so they can be retried on reconnect.
          if (dispatchSucceeded) {
            const messageId = event.payload.id;
            const roomId = event.roomId ?? event.payload.chat_room_id;
            if (roomId && messageId) {
              try {
                await link.markProcessed(roomId, messageId, { bestEffort: true });
              } catch (markErr) {
                console.warn(`[thenvoi:${accountId}] Failed to mark message ${messageId} as processed:`, markErr);
              }
            }
          }
        };

        // Create a singleton ContactEventHandler for this account.
        // Uses "callback" strategy to dispatch contact events directly to the
        // OpenClaw agent as synthetic messages on the CONTACTS_THREAD_ID virtual
        // thread (mirrors the old "direct" strategy that the SDK doesn't have).
        //
        // Note: the SDK's in-memory dedup (Set + LRU eviction) is ephemeral —
        // contact events may be reprocessed after a restart.  The old
        // ContactStateStore persisted dedup keys to disk, but the SDK doesn't
        // support that.  In practice this is acceptable: reprocessed events are
        // idempotent (approve/reject are no-ops on already-resolved requests).
        const contactHandler = new ContactEventHandler({
          config: {
            strategy: "callback",
            broadcastChanges: true,
            onEvent: async (event: ContactEvent) => {
              const text = await contactHandler.formatEventMessage(event);
              const now = new Date().toISOString();
              const message: OpenClawInboundMessage = {
                channelId: "thenvoi",
                threadId: CONTACTS_THREAD_ID,
                senderId: "contact-events",
                senderType: "System",
                senderName: "Contact Events",
                text,
                timestamp: now,
                metadata: { contactEventType: event.type },
              };

              // Dispatch through the same path as regular messages
              const rt = registry().openclawRuntime;
              const dispatchFn = rt?.channel?.reply?.dispatchReplyFromConfig;
              if (rt?.config && dispatchFn) {
                const inboundCtx = buildInboundCtx(message);
                const dispatcher = createNoopDispatcher();

                console.log(`[thenvoi:${accountId}] Dispatching contact event to OpenClaw agent: ${event.type}`);
                const cfg = rt.config.loadConfig();
                await dispatchFn({ ctx: inboundCtx, cfg, dispatcher });
              } else {
                deliverMessage(message, accountId);
              }
            },
          },
          rest: link.rest,
          onBroadcast: (msg: string) => {
            console.log(`[thenvoi:${accountId}] Contact broadcast: ${msg}`);
          },
        });

        // Handle contact events
        presence.onContactEvent = async (event: ContactEvent) => {
          try {
            console.log(`[thenvoi:${accountId}] Contact event: ${event.type}`);
            await contactHandler.handle(event);
          } catch (error) {
            console.error(`[thenvoi:${accountId}] Failed to handle contact event:`, error);
          }
        };

        presences().set(accountId, presence);

        // Start the event loop
        await presence.start();

        console.log(`[thenvoi:${accountId}] Connected to Thenvoi platform`);

        // Hydrate: drain pending (unprocessed) messages for each joined room.
        // RoomPresence only handles live WebSocket events — messages sent while
        // the agent was offline are sitting in the queue and must be polled via
        // getNextMessage. This mirrors the old runtime.ts recovery logic.
        if (presence.onRoomEvent) {
          const roomHandler = presence.onRoomEvent;
          const joinedRooms = [...registry().roomToAccount.entries()]
            .filter(([, acct]) => acct === accountId)
            .map(([roomId]) => roomId);

          for (const roomId of joinedRooms) {
            try {
              let drained = 0;
              const seenIds = new Set<string>();
              const MAX_HYDRATE = 50; // Safety cap to prevent infinite loops
              while (drained < MAX_HYDRATE) {
                const message = await link.getNextMessage(roomId);
                if (!message) break;

                const m = message as unknown as Record<string, unknown>;
                const msgId = String(m.id ?? "");

                // If we've seen this message before, markProcessed isn't working — break to avoid infinite loop
                if (seenIds.has(msgId)) {
                  console.warn(`[thenvoi:${accountId}] Hydration: message ${msgId} returned again after marking, stopping`);
                  break;
                }
                seenIds.add(msgId);

                console.log(`[thenvoi:${accountId}] Hydrating pending message in room ${roomId} (id=${msgId})`);

                // Convert PlatformMessageLike → PlatformEvent for the room handler
                const syntheticEvent = {
                  type: "message_created",
                  roomId,
                  payload: {
                    id: msgId,
                    chat_room_id: roomId,
                    content: String(m.content ?? ""),
                    sender_id: String(m.senderId ?? ""),
                    sender_type: String(m.senderType ?? "User"),
                    sender_name: m.senderName != null ? String(m.senderName) : undefined,
                    message_type: String(m.messageType ?? "text"),
                    inserted_at: m.createdAt instanceof Date ? m.createdAt.toISOString() : String(m.createdAt ?? new Date().toISOString()),
                    metadata: (m.metadata ?? {}) as Record<string, unknown>,
                  },
                };
                await roomHandler(roomId, syntheticEvent as PlatformEvent);
                drained++;
              }
              if (drained > 0) {
                console.log(`[thenvoi:${accountId}] Hydrated ${drained} pending message(s) in room ${roomId}`);
              }
            } catch (error) {
              // getNextMessage may throw UnsupportedFeatureError if the REST
              // adapter doesn't support message queues — that's fine, skip hydration.
              const msg = error instanceof Error ? error.message : String(error);
              if (msg.includes("UnsupportedFeature") || msg.includes("not available")) {
                console.log(`[thenvoi:${accountId}] Message hydration not available, skipping`);
              } else {
                console.error(`[thenvoi:${accountId}] Failed to hydrate room ${roomId}:`, error);
              }
            }
          }
        }

        // Block until OpenClaw signals shutdown — startAccount must stay
        // alive for the lifetime of the connection, otherwise OpenClaw
        // treats the exit as a failure and triggers auto-restart.
        if (!ctx.abortSignal.aborted) {
          await new Promise<void>((resolve) => {
            ctx.abortSignal.addEventListener("abort", () => resolve(), { once: true });
          });
        }

        console.log(`[thenvoi:${accountId}] Shutdown signal received`);
      } finally {
        registry().startingAccounts.delete(accountId);
      }
    },

    stopAccount: async (ctx: GatewayContext): Promise<void> => {
      const { accountId } = ctx;
      registry().startingAccounts.delete(accountId);

      const presence = presences().get(accountId);
      if (presence) {
        await presence.stop();
        presences().delete(accountId);
      }

      const link = links().get(accountId);
      if (link) {
        await link.disconnect();
        links().delete(accountId);
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
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        return uuidPattern.test(raw.trim());
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
  api.registerChannel({ plugin: thenvoiChannel });
  console.log("[thenvoi] Channel registered");
}

// =============================================================================
// Utility Exports (for MCP tools)
// =============================================================================

/**
 * Get the ThenvoiLink for an account.
 */
export function getLink(accountId: string = "default"): ThenvoiLink | undefined {
  return links().get(accountId);
}

/**
 * Get the ThenvoiLink that owns a given room.
 * Falls back to the "default" account if the room isn't mapped.
 */
export function getLinkForRoom(roomId: string): ThenvoiLink | undefined {
  const accountId = registry().roomToAccount.get(roomId) ?? "default";
  return links().get(accountId);
}

/**
 * Get the current agent's ID (UUID).
 */
export function getAgentId(accountId: string = "default"): string | undefined {
  return links().get(accountId)?.agentId;
}
