/**
 * Thenvoi Channel Plugin for OpenClaw.
 *
 * Registers the Thenvoi channel with OpenClaw Gateway,
 * enabling bidirectional communication with the Thenvoi platform.
 */

import type {
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

interface OutboundAdapter {
  deliveryMode: "direct" | "queued";
  sendText: (params: SendTextParams) => Promise<SendTextResult>;
}

interface SendTextParams {
  text: string;
  threadId?: string;
  accountId?: string;
  mentions?: string[];
}

interface SendTextResult {
  ok: boolean;
  error?: string;
}

interface SetupHelpers {
  validateConfig?: (config: ThenvoiAccountConfig) => Promise<ValidationResult>;
}

interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

interface GatewayHelpers {
  start: (accountId: string, config: ThenvoiAccountConfig) => Promise<void>;
  stop: (accountId: string) => Promise<void>;
}

interface ThreadingHelpers {
  extractThreadId: (message: OpenClawInboundMessage) => string;
  formatThreadContext?: (threadId: string) => string;
}

interface PluginConfig {
  channels?: {
    thenvoi?: {
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
    };
  };
}

// =============================================================================
// Channel State
// =============================================================================

// Active runtimes per account
const runtimes: Map<string, ThenvoiRuntime> = new Map();
const clients: Map<string, ThenvoiClient> = new Map();

// Track last sender per thread for auto-mention fallback
// Key: threadId, Value: { senderId, senderName }
const lastSenderByThread: Map<string, { senderId: string; senderName: string }> = new Map();

// Gateway callback for delivering inbound messages
let deliverInbound: ((message: OpenClawInboundMessage) => void) | null = null;

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
  const userId = account.userId ?? process.env.THENVOI_API_KEY_USER;
  const wsUrl = account.wsUrl ?? process.env.THENVOI_WS_URL ?? "wss://api.thenvoi.com/socket";
  const restUrl = account.restUrl ?? process.env.THENVOI_REST_URL ?? "https://api.thenvoi.com";

  if (!apiKey) {
    throw new Error("THENVOI_API_KEY is required");
  }
  if (!agentId) {
    throw new Error("THENVOI_AGENT_ID is required");
  }
  if (!userId) {
    throw new Error("THENVOI_API_KEY_USER is required");
  }

  return { apiKey, agentId, userId, wsUrl, restUrl };
}

// =============================================================================
// Channel Definition
// =============================================================================

export const thenvoiChannel: OpenClawChannel = {
  id: "thenvoi",

  meta: {
    id: "thenvoi",
    label: "Thenvoi",
    selectionLabel: "Thenvoi (AI Collaboration)",
    docsPath: "/channels/thenvoi",
    blurb: "Connect to the Thenvoi AI agent collaboration platform.",
    aliases: ["thenvoi"],
  },

  capabilities: {
    chatTypes: ["direct", "group"],
    features: ["threading", "mentions"],
  },

  config: {
    listAccountIds: (config: PluginConfig): string[] => {
      // Check both plugin config and channels config
      const pluginAccounts = config.plugins?.entries?.thenvoi?.config?.accounts ?? {};
      const channelAccounts = config.channels?.thenvoi?.accounts ?? {};
      const accounts = { ...pluginAccounts, ...channelAccounts };
      return Object.keys(accounts);
    },

    resolveAccount: (
      config: PluginConfig,
      accountId?: string,
    ): ThenvoiAccountConfig => {
      // Check both plugin config and channels config
      const pluginAccounts = config.plugins?.entries?.thenvoi?.config?.accounts ?? {};
      const channelAccounts = config.channels?.thenvoi?.accounts ?? {};
      const accounts = { ...pluginAccounts, ...channelAccounts };
      const account = accounts[accountId ?? "default"] ?? { enabled: true };
      return account;
    },
  },

  outbound: {
    deliveryMode: "direct",

    sendText: async (params: SendTextParams): Promise<SendTextResult> => {
      const { text, threadId, accountId } = params;

      if (!threadId) {
        return { ok: false, error: "threadId (room_id) is required" };
      }

      const client = clients.get(accountId ?? "default");
      if (!client) {
        return { ok: false, error: "Thenvoi client not initialized" };
      }

      try {
        // Convert mention names to MentionRequest objects
        const mentionNames = params.mentions ?? [];
        let mentions: MentionRequest[] = [];

        // Get participants for the room (needed for mention resolution and fallback)
        const participants = await client.getParticipants(threadId);
        const agent = await client.getAgentMe();

        if (mentionNames.length > 0) {
          // Resolve mention names to full objects (excluding self-mentions)
          mentions = mentionNames
            .map((name) => {
              const participant = participants.find((p) => p.name === name && p.id !== agent.id);
              return participant ? { id: participant.id, name: participant.name } : null;
            })
            .filter((m): m is MentionRequest => m !== null);
        }

        // API requires at least 1 mention but you can't mention yourself
        // Fallback: prefer the last sender (the person we're replying to)
        if (mentions.length === 0) {
          const lastSender = lastSenderByThread.get(threadId);

          if (lastSender) {
            // Find the last sender in participants to verify they're still in the room
            const senderParticipant = participants.find(
              (p) => p.id === lastSender.senderId && p.id !== agent.id
            );
            if (senderParticipant) {
              mentions = [{ id: senderParticipant.id, name: senderParticipant.name }];
            }
          }

          // If still no mentions, fall back to first other participant
          if (mentions.length === 0) {
            const otherParticipant = participants.find((p) => p.id !== agent.id);
            if (!otherParticipant) {
              return { ok: false, error: "Cannot send message: no other participants to mention" };
            }
            mentions = [{ id: otherParticipant.id, name: otherParticipant.name }];
          }
        }

        await client.sendMessage(threadId, text, mentions);
        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, error: message };
      }
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
    start: async (
      accountId: string,
      accountConfig: ThenvoiAccountConfig,
    ): Promise<void> => {
      if (runtimes.has(accountId)) {
        return; // Already running
      }

      const config = resolveConfig(accountConfig);

      // Create REST client
      const client = new ThenvoiClient(config);
      clients.set(accountId, client);

      // Create and start runtime with client
      const runtime = new ThenvoiRuntime(
        config,
        {
          onMessage: (message) => {
            if (deliverInbound) {
              deliverInbound(message);
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
      );

      await runtime.connect();
      runtimes.set(accountId, runtime);

      console.log(`[thenvoi:${accountId}] Connected to Thenvoi platform`);
    },

    stop: async (accountId: string): Promise<void> => {
      const runtime = runtimes.get(accountId);
      if (runtime) {
        await runtime.disconnect();
        runtimes.delete(accountId);
      }

      clients.delete(accountId);

      console.log(`[thenvoi] Disconnected from Thenvoi platform (${accountId})`);
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
