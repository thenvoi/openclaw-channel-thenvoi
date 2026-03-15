/**
 * Thenvoi Channel Runtime.
 *
 * Manages WebSocket connection to Thenvoi platform and handles
 * multi-room subscription and event routing.
 */

import { Socket, Channel } from "phoenix";
import { RateLimitAwareWebSocket } from "./rate-limit-websocket.js";

import type {
  ContactAddedPayload,
  ContactEvent,
  ContactEventConfig,
  ContactRemovedPayload,
  ContactRequestReceivedPayload,
  ContactRequestUpdatedPayload,
  MessageCreatedPayload,
  NextMessageResponse,
  OpenClawInboundMessage,
  Participant,
  ParticipantAddedPayload,
  ParticipantRemovedPayload,
  ReconnectConfig,
  RoomAddedPayload,
  RoomRemovedPayload,
  RoomState,
  ThenvoiConfig,
  ThenvoiEvent,
} from "./types.js";
import { ThenvoiConnectionError, ThenvoiRateLimitError } from "./types.js";
import { ThenvoiClient } from "./thenvoi-client.js";
import { ContactEventHandler } from "./contact-handler.js";

export interface RuntimeCallbacks {
  onMessage: (message: OpenClawInboundMessage) => void;
  onRoomJoined?: (roomId: string, title: string) => void;
  onRoomLeft?: (roomId: string) => void;
  onParticipantJoined?: (roomId: string, name: string) => void;
  onParticipantLeft?: (roomId: string, name: string) => void;
  onError?: (error: Error) => void;
  // Reconnection callbacks
  onReconnecting?: (attempt: number, delayMs: number) => void;
  onReconnected?: () => void;
  // Sync callbacks
  onSyncStarted?: () => void;
  onSyncCompleted?: (messageCount: number) => void;
  onSyncError?: (error: Error) => void;
  // Contact callbacks
  onContactRequestReceived?: (payload: ContactRequestReceivedPayload) => void;
  onContactRequestUpdated?: (payload: ContactRequestUpdatedPayload) => void;
  onContactAdded?: (payload: ContactAddedPayload) => void;
  onContactRemoved?: (payload: ContactRemovedPayload) => void;
}

export class ThenvoiRuntime {
  private readonly config: ThenvoiConfig;
  private readonly callbacks: RuntimeCallbacks;
  private readonly client: ThenvoiClient;

  private socket: Socket | null = null;
  private agentChannel: Channel | null = null;
  private contactsChannel: Channel | null = null;
  private rooms: Map<string, RoomState> = new Map();
  private roomChannels: Map<string, { chat: Channel; participants: Channel }> =
    new Map();

  private connected = false;
  private reconnecting = false;

  // Message recovery state
  private syncPointMessageId: string | null = null;
  private isSynchronizing = false;
  private processedMessageIds: Set<string> = new Set();

  // Queue for WS messages that arrive during sync (like Python SDK)
  private pendingWsMessages: Array<{ roomId: string; payload: MessageCreatedPayload }> = [];

  // Reconnection state
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalDisconnect = false;
  private rateLimitRetryAfterMs: number | null = null;

  private readonly reconnectConfig: ReconnectConfig = {
    baseDelayMs: 1000,
    maxDelayMs: 60000,
    multiplier: 2,
    jitterFactor: 0.1,
    maxAttempts: 10,
  };

  // Contact event handling
  private contactEventHandler: ContactEventHandler | null = null;
  private readonly contactConfig: ContactEventConfig;
  private pendingContactBroadcasts: string[] = [];

  /**
   * Get the agent's own ID (UUID).
   */
  get agentId(): string {
    return this.config.agentId;
  }

  constructor(
    config: ThenvoiConfig,
    callbacks: RuntimeCallbacks,
    client?: ThenvoiClient,
    contactConfig?: ContactEventConfig,
  ) {
    this.config = config;
    this.callbacks = callbacks;
    this.client = client ?? new ThenvoiClient(config);
    this.contactConfig = contactConfig ?? { strategy: "disabled" };
  }

  // ===========================================================================
  // Connection Management
  // ===========================================================================

  /**
   * Connect to the Thenvoi platform.
   */
  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    this.intentionalDisconnect = false;

    return new Promise((resolve, reject) => {
      const socketParams = {
        api_key: this.config.apiKey,
        agent_id: this.config.agentId,
      };
      console.log(`[thenvoi] Connecting to WebSocket: ${this.config.wsUrl}`);
      console.log(`[thenvoi] Socket params:`, JSON.stringify(socketParams));
      this.socket = new Socket(this.config.wsUrl, {
        params: () => socketParams,
        transport: RateLimitAwareWebSocket as any,
      } as any);

      this.setupSocketHandlers();

      this.socket.onOpen(async () => {
        console.log("[thenvoi] WebSocket connection opened");
        try {
          this.connected = true;
          this.reconnecting = false;
          this.reconnectAttempts = 0;

          // Join agent channel
          await this.joinAgentChannel();

          // Join contacts channel
          await this.joinContactsChannel();

          // Set up contact event handling
          await this.setupContactHandling();

          // Fetch and join existing rooms
          await this.joinExistingRooms();

          // Synchronize with backlog
          await this.synchronizeWithBacklog();

          resolve();
        } catch (error) {
          reject(error);
        }
      });

      this.socket.onError((error: unknown) => {
        // Check if underlying transport detected rate limiting
        const conn = (this.socket as any)?.conn as
          | RateLimitAwareWebSocket
          | undefined;
        if (conn?.rateLimitRetryAfterMs) {
          this.rateLimitRetryAfterMs = conn.rateLimitRetryAfterMs;
          console.log(
            `[thenvoi] Rate limit detected, will wait ${this.rateLimitRetryAfterMs}ms before reconnect`,
          );
        }

        const errorStr =
          error instanceof Error
            ? error.message
            : typeof error === "object"
              ? JSON.stringify(error)
              : String(error);
        const err = new ThenvoiConnectionError(`WebSocket error: ${errorStr}`);
        this.callbacks.onError?.(err);
        if (!this.connected) {
          reject(err);
        }
      });

      this.socket.connect();
    });
  }

  /**
   * Disconnect from the Thenvoi platform.
   */
  async disconnect(): Promise<void> {
    this.intentionalDisconnect = true;

    // Clear reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Leave all room channels
    for (const [roomId, channels] of this.roomChannels) {
      channels.chat.leave();
      channels.participants.leave();
      this.roomChannels.delete(roomId);
    }

    // Leave contacts channel
    this.contactsChannel?.leave();
    this.contactsChannel = null;

    // Leave agent channel
    this.agentChannel?.leave();
    this.agentChannel = null;

    // Disconnect socket
    this.socket?.disconnect();
    this.socket = null;

    // Clear state
    this.connected = false;
    this.reconnecting = false;
    this.reconnectAttempts = 0;
    this.syncPointMessageId = null;
    this.processedMessageIds.clear();
    this.pendingWsMessages = [];
    this.rooms.clear();
  }

  /**
   * Set up socket event handlers.
   */
  private setupSocketHandlers(): void {
    if (!this.socket) return;

    this.socket.onClose(() => {
      console.log("[thenvoi] WebSocket connection closed");
      this.connected = false;

      // Check if rate limited before triggering reconnection
      const conn = (this.socket as any)?.conn as
        | RateLimitAwareWebSocket
        | undefined;
      if (conn?.rateLimitRetryAfterMs) {
        this.rateLimitRetryAfterMs = conn.rateLimitRetryAfterMs;
        console.log(
          `[thenvoi] Rate limit detected on close, will wait ${this.rateLimitRetryAfterMs}ms`,
        );
      }

      if (!this.intentionalDisconnect) {
        this.callbacks.onError?.(
          new ThenvoiConnectionError("WebSocket connection closed"),
        );
        this.handleReconnection();
      }
    });
  }

  // ===========================================================================
  // Reconnection Logic
  // ===========================================================================

  /**
   * Calculate reconnection delay with exponential backoff and jitter.
   * If rate limited, use the server-specified retry delay instead.
   */
  private calculateReconnectDelay(): number {
    // If rate limited, use the server-specified delay
    if (this.rateLimitRetryAfterMs !== null) {
      const delay = this.rateLimitRetryAfterMs;
      this.rateLimitRetryAfterMs = null; // Clear after use
      return delay;
    }

    const { baseDelayMs, maxDelayMs, multiplier, jitterFactor } =
      this.reconnectConfig;

    // Exponential backoff
    const exponentialDelay =
      baseDelayMs * Math.pow(multiplier, this.reconnectAttempts);

    // Cap at max delay
    const cappedDelay = Math.min(exponentialDelay, maxDelayMs);

    // Add jitter to prevent thundering herd
    const jitter = cappedDelay * jitterFactor * (Math.random() * 2 - 1);

    return Math.round(cappedDelay + jitter);
  }

  /**
   * Handle reconnection with exponential backoff.
   */
  private handleReconnection(): void {
    if (this.intentionalDisconnect) {
      return;
    }

    // Prevent concurrent reconnection attempts
    if (this.reconnecting) {
      return;
    }

    if (this.reconnectAttempts >= this.reconnectConfig.maxAttempts) {
      const error = new ThenvoiConnectionError(
        `Max reconnection attempts (${this.reconnectConfig.maxAttempts}) exceeded`,
      );
      this.callbacks.onError?.(error);
      return;
    }

    this.reconnecting = true;
    this.reconnectAttempts++;

    const delayMs = this.calculateReconnectDelay();
    this.callbacks.onReconnecting?.(this.reconnectAttempts, delayMs);

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.performReconnection();
      } catch (error) {
        // If rate limited, use the server-specified delay for next attempt
        if (error instanceof ThenvoiRateLimitError) {
          console.log(`[thenvoi] Rate limited, will retry in ${Math.ceil(error.retryAfterMs / 1000)}s`);
          this.rateLimitRetryAfterMs = error.retryAfterMs;
        }
        // Reset reconnecting flag to allow next attempt
        this.reconnecting = false;
        // Schedule another attempt
        this.handleReconnection();
      }
    }, delayMs);
  }

  /**
   * Perform reconnection with state recovery.
   */
  private async performReconnection(): Promise<void> {
    // Store current room state for recovery
    const roomsToRestore = new Map(this.rooms);

    // Reset connection state
    this.socket = null;
    this.agentChannel = null;
    this.contactsChannel = null;
    this.roomChannels.clear();
    this.syncPointMessageId = null; // Reset sync point for new sync
    this.pendingWsMessages = []; // Clear pending queue for fresh sync

    // Create new socket
    const socketParams = {
      api_key: this.config.apiKey,
      agent_id: this.config.agentId,
    };
    this.socket = new Socket(this.config.wsUrl, {
      params: () => socketParams,
      transport: RateLimitAwareWebSocket as any,
    } as any);

    // Set up socket handlers
    this.setupSocketHandlers();

    // Connect and wait for open
    await new Promise<void>((resolve, reject) => {
      this.socket!.onOpen(() => resolve());
      this.socket!.onError((error: unknown) =>
        reject(new ThenvoiConnectionError(String(error))),
      );
      this.socket!.connect();
    });

    // Join agent channel
    await this.joinAgentChannel();

    // Join contacts channel
    await this.joinContactsChannel();

    // Synchronize with backlog
    await this.synchronizeWithBacklog();

    // Restore room subscriptions
    for (const [roomId, roomState] of roomsToRestore) {
      try {
        await this.joinRoomChannels(roomId);
        // Restore room state
        this.rooms.set(roomId, roomState);
      } catch (_error) {
        // Room may no longer be accessible, remove from state
        this.rooms.delete(roomId);
        this.callbacks.onRoomLeft?.(roomId);
      }
    }

    // Refresh participant lists for restored rooms
    await this.refreshParticipantLists();

    // Reset reconnection state
    this.connected = true;
    this.reconnecting = false;
    this.reconnectAttempts = 0;

    this.callbacks.onReconnected?.();
  }

  /**
   * Refresh participant lists for all rooms after reconnection.
   */
  private async refreshParticipantLists(): Promise<void> {
    for (const [roomId, roomState] of this.rooms) {
      try {
        const participants = await this.client.getParticipants(roomId);
        roomState.participants = participants;
      } catch (_error) {
        // Log but don't fail - participants will be updated via events
      }
    }
  }

  // ===========================================================================
  // Message Recovery (Sync Point Pattern)
  // ===========================================================================

  /**
   * Synchronize with message backlog using the sync point pattern.
   * Syncs each room individually like the Python SDK.
   */
  private async synchronizeWithBacklog(): Promise<void> {
    this.isSynchronizing = true;
    this.callbacks.onSyncStarted?.();

    let totalProcessedCount = 0;

    try {
      // Sync each room individually (like Python SDK)
      for (const [roomId, _roomState] of this.rooms) {
        console.log(`[thenvoi] Syncing backlog for room ${roomId}...`);
        let roomProcessedCount = 0;

        while (true) {
          // Use per-room endpoint like Python SDK
          const message = await this.client.getNextMessage(roomId);

          // No more backlog messages for this room
          if (!message) {
            console.log(`[thenvoi] Room ${roomId}: no more backlog messages`);
            break;
          }

          console.log(`[thenvoi] Room ${roomId}: got backlog message ${message.id} from ${message.sender_name ?? message.sender_type}`);

          // Reached sync point - backlog complete
          if (this.syncPointMessageId && message.id === this.syncPointMessageId) {
            console.log(`[thenvoi] Room ${roomId}: reached sync point`);
            // Still process this message as it's the first WS message we received
            await this.processBacklogMessage(message);
            roomProcessedCount++;
            break;
          }

          // Skip own messages (must call processing before processed per API spec)
          if (message.sender_id === this.config.agentId) {
            console.log(`[thenvoi] Room ${roomId}: skipping own message ${message.id}`);
            try {
              await this.client.markMessageProcessing(message.chat_room_id, message.id);
              await this.client.markMessageProcessed(message.chat_room_id, message.id);
            } catch {
              // Ignore errors - message may already be processed
            }
            continue;
          }

          // Skip non-text messages (must call processing before processed per API spec)
          if (message.message_type !== "text") {
            console.log(`[thenvoi] Room ${roomId}: skipping non-text message ${message.id} (type: ${message.message_type})`);
            try {
              await this.client.markMessageProcessing(message.chat_room_id, message.id);
              await this.client.markMessageProcessed(message.chat_room_id, message.id);
            } catch {
              // Ignore errors - message may already be processed
            }
            continue;
          }

          // Process the backlog message
          await this.processBacklogMessage(message);
          roomProcessedCount++;
        }

        console.log(`[thenvoi] Room ${roomId}: synced ${roomProcessedCount} messages`);
        totalProcessedCount += roomProcessedCount;
      }

      // After sync completes, process any WS messages that arrived during sync
      // (like Python SDK's approach of processing queued messages after sync)
      const pendingCount = await this.processPendingWsMessages();
      totalProcessedCount += pendingCount;

      // Clear sync state (like Python SDK clears marker and dedupe cache after sync)
      this.syncPointMessageId = null;
      // Note: We keep processedMessageIds for ongoing deduplication

      this.callbacks.onSyncCompleted?.(totalProcessedCount);
    } catch (error) {
      this.callbacks.onSyncError?.(error as Error);
      throw error;
    } finally {
      this.isSynchronizing = false;
      // Clear any remaining pending messages on error
      this.pendingWsMessages = [];
    }
  }

  /**
   * Process WebSocket messages that were queued during sync.
   * These messages arrived via WS while we were syncing via REST.
   * They may or may not have been processed via REST (dedupe check handles this).
   */
  private async processPendingWsMessages(): Promise<number> {
    const pendingMessages = [...this.pendingWsMessages];
    this.pendingWsMessages = [];

    if (pendingMessages.length === 0) {
      return 0;
    }

    console.log(`[thenvoi] Processing ${pendingMessages.length} queued WS messages after sync`);

    let processedCount = 0;
    for (const { roomId, payload } of pendingMessages) {
      // Skip if already processed during sync (via REST)
      if (this.processedMessageIds.has(payload.id)) {
        console.log(`[thenvoi] Skipping queued message ${payload.id} (already processed via REST)`);
        continue;
      }

      // Skip own messages
      if (payload.sender_id === this.config.agentId) {
        console.log(`[thenvoi] Skipping queued own message ${payload.id}`);
        try {
          await this.client.markMessageProcessing(roomId, payload.id);
          await this.client.markMessageProcessed(roomId, payload.id);
        } catch {
          // Ignore errors
        }
        continue;
      }

      // Skip non-text messages
      if (payload.message_type !== "text") {
        console.log(`[thenvoi] Skipping queued non-text message ${payload.id}`);
        try {
          await this.client.markMessageProcessing(roomId, payload.id);
          await this.client.markMessageProcessed(roomId, payload.id);
        } catch {
          // Ignore errors
        }
        continue;
      }

      // Process the message
      try {
        await this.processWsMessage(roomId, payload);
        processedCount++;
      } catch (error) {
        console.error(`[thenvoi] Error processing queued message ${payload.id}:`, error);
      }
    }

    console.log(`[thenvoi] Processed ${processedCount} queued WS messages`);
    return processedCount;
  }

  /**
   * Process a WebSocket message (either live or from pending queue).
   * Extracted from handleMessageCreated to be reusable.
   */
  private async processWsMessage(roomId: string, payload: MessageCreatedPayload): Promise<void> {
    // Update room state
    const room = this.rooms.get(roomId);
    if (room) {
      room.lastMessageId = payload.id;
    }

    // Mark as processing
    try {
      await this.client.markMessageProcessing(roomId, payload.id);
    } catch {
      console.log(`[thenvoi] Note: could not mark message ${payload.id} as processing`);
    }

    try {
      // Look up sender name from room participants
      const roomState = this.rooms.get(roomId);
      const participant = roomState?.participants.find(p => p.id === payload.sender_id);
      const senderName = participant?.name ?? payload.sender_type ?? "Unknown";

      console.log(`[thenvoi] Sender lookup: sender_id=${payload.sender_id}, participants=${roomState?.participants.length ?? 0}, found=${participant?.name ?? 'none'}, using=${senderName}`);

      const message: OpenClawInboundMessage = {
        channelId: "thenvoi",
        threadId: roomId,
        senderId: payload.sender_id,
        senderType: payload.sender_type,
        senderName,
        text: payload.content,
        timestamp: payload.inserted_at,
        metadata: {
          messageId: payload.id,
          mentions: payload.metadata?.mentions,
        },
      };

      // Deliver to OpenClaw
      this.callbacks.onMessage(message);

      // Mark as processed
      await this.client.markMessageProcessed(roomId, payload.id);
      this.processedMessageIds.add(payload.id);

      console.log(`[thenvoi] Message ${payload.id} delivered and marked as processed`);
    } catch (error) {
      // Mark as failed
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[thenvoi] Error processing message ${payload.id}:`, errorMessage);
      try {
        await this.client.markMessageFailed(roomId, payload.id, errorMessage);
      } catch {
        // Ignore errors marking as failed
      }
      throw error;
    }
  }

  /**
   * Process a message from the backlog.
   */
  private async processBacklogMessage(
    message: NextMessageResponse,
  ): Promise<void> {
    const messageId = message.id;
    const roomId = message.chat_room_id;

    // Skip if already processed
    if (this.processedMessageIds.has(messageId)) {
      return;
    }

    // Mark as processing to prevent duplicates
    try {
      await this.client.markMessageProcessing(roomId, messageId);
    } catch {
      // Log but continue - the server might have already marked it
    }

    try {
      // Convert to OpenClaw format
      const openClawMessage: OpenClawInboundMessage = {
        channelId: "thenvoi",
        threadId: roomId,
        senderId: message.sender_id,
        senderType: message.sender_type,
        senderName: message.sender_name,
        text: message.content,
        timestamp: message.inserted_at,
        metadata: {
          messageId: message.id,
          mentions: message.metadata?.mentions,
        },
      };

      // Deliver to OpenClaw
      this.callbacks.onMessage(openClawMessage);

      // Mark as processed
      await this.client.markMessageProcessed(roomId, messageId);
      this.processedMessageIds.add(messageId);
    } catch (error) {
      // Mark as failed
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.client.markMessageFailed(roomId, messageId, errorMessage);
      throw error;
    }
  }

  /**
   * Check if connected.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get current room states.
   */
  getRooms(): Map<string, RoomState> {
    return new Map(this.rooms);
  }

  /**
   * Check if currently synchronizing backlog.
   */
  isSyncing(): boolean {
    return this.isSynchronizing;
  }

  /**
   * Check if currently attempting to reconnect.
   */
  isReconnectingNow(): boolean {
    return this.reconnecting;
  }

  /**
   * Get current reconnection attempt number.
   */
  getReconnectAttempt(): number {
    return this.reconnectAttempts;
  }

  /**
   * Get the number of processed messages (for deduplication tracking).
   */
  getProcessedMessageCount(): number {
    return this.processedMessageIds.size;
  }

  /**
   * Clear processed message cache.
   * Can be called periodically to free memory after a stable connection period.
   */
  clearProcessedMessageCache(): void {
    this.processedMessageIds.clear();
  }

  // ===========================================================================
  // Channel Management
  // ===========================================================================

  private async joinAgentChannel(): Promise<void> {
    if (!this.socket) {
      throw new ThenvoiConnectionError("Socket not connected");
    }

    const topic = `agent_rooms:${this.config.agentId}`;
    this.agentChannel = this.socket.channel(topic, {});

    // Room lifecycle events
    this.agentChannel.on("room_added", (payload) => {
      this.handleEvent({ type: "room_added", payload: payload as RoomAddedPayload });
    });

    this.agentChannel.on("room_removed", (payload) => {
      this.handleEvent({ type: "room_removed", payload: payload as RoomRemovedPayload });
    });

    return new Promise((resolve, reject) => {
      this.agentChannel!.join()
        .receive("ok", () => {
          resolve();
        })
        .receive("error", (reason: unknown) => {
          reject(
            new ThenvoiConnectionError(`Failed to join agent channel: ${reason}`),
          );
        })
        .receive("timeout", () => {
          reject(new ThenvoiConnectionError("Timeout joining agent channel"));
        });
    });
  }

  /**
   * Join the contacts channel for contact events.
   */
  private async joinContactsChannel(): Promise<void> {
    if (!this.socket) {
      throw new ThenvoiConnectionError("Socket not connected");
    }

    const topic = `agent_contacts:${this.config.agentId}`;
    this.contactsChannel = this.socket.channel(topic, {});

    // Contact lifecycle events
    this.contactsChannel.on("contact_request_received", (payload) => {
      this.handleContactEvent({
        type: "contact_request_received",
        payload: payload as ContactRequestReceivedPayload,
      });
    });

    this.contactsChannel.on("contact_request_updated", (payload) => {
      this.handleContactEvent({
        type: "contact_request_updated",
        payload: payload as ContactRequestUpdatedPayload,
      });
    });

    this.contactsChannel.on("contact_added", (payload) => {
      this.handleContactEvent({
        type: "contact_added",
        payload: payload as ContactAddedPayload,
      });
    });

    this.contactsChannel.on("contact_removed", (payload) => {
      this.handleContactEvent({
        type: "contact_removed",
        payload: payload as ContactRemovedPayload,
      });
    });

    return new Promise((resolve) => {
      this.contactsChannel!.join()
        .receive("ok", () => {
          console.log(`[thenvoi] Joined contacts channel: ${topic}`);
          resolve();
        })
        .receive("error", (reason: unknown) => {
          // Don't fail if contacts channel is not available (platform may not support it yet)
          console.warn(`[thenvoi] Could not join contacts channel: ${reason}`);
          this.contactsChannel = null;
          resolve();
        })
        .receive("timeout", () => {
          console.warn("[thenvoi] Timeout joining contacts channel");
          this.contactsChannel = null;
          resolve();
        });
    });
  }

  /**
   * Fetch existing rooms from the API and join them.
   */
  private async joinExistingRooms(): Promise<void> {
    try {
      const response = await this.client.listChats();
      // Handle both { chats: [...] } and { data: [...] } response formats
      const chats = response.chats ?? (response as unknown as { data: Array<{ id: string; title: string }> }).data ?? [];

      console.log(`[thenvoi] Found ${chats.length} existing rooms`);

      for (const chat of chats) {
        // Fetch participants for the room
        let participants: Participant[] = [];
        try {
          participants = await this.client.getParticipants(chat.id);
          console.log(`[thenvoi] Room ${chat.id}: loaded ${participants.length} participants: ${participants.map(p => p.name).join(', ')}`);
        } catch (error) {
          // Continue without participants - they'll be updated via events
          console.warn(`[thenvoi] Room ${chat.id}: failed to load participants:`, error);
        }

        // Initialize room state with participants
        this.rooms.set(chat.id, {
          roomId: chat.id,
          title: chat.title,
          participants,
          joinedAt: new Date(),
        });

        // Join room channels
        try {
          await this.joinRoomChannels(chat.id);
          this.callbacks.onRoomJoined?.(chat.id, chat.title);
        } catch (error) {
          this.callbacks.onError?.(error as Error);
          this.rooms.delete(chat.id);
        }
      }
    } catch (error) {
      // Log but don't fail - rooms can still be joined via room_added events
      this.callbacks.onError?.(
        new ThenvoiConnectionError(`Failed to fetch existing rooms: ${error}`),
      );
    }
  }

  private async joinRoomChannels(roomId: string): Promise<void> {
    if (!this.socket) {
      throw new ThenvoiConnectionError("Socket not connected");
    }

    // Join chat_room channel for messages
    const chatChannel = this.socket.channel(`chat_room:${roomId}`, {});
    chatChannel.on("message_created", (payload) => {
      this.handleEvent({ type: "message_created", roomId, payload: payload as MessageCreatedPayload });
    });

    // Join room_participants channel for participant changes
    const participantsChannel = this.socket.channel(
      `room_participants:${roomId}`,
      {},
    );
    participantsChannel.on("participant_added", (payload) => {
      this.handleEvent({
        type: "participant_added",
        roomId,
        payload: payload as ParticipantAddedPayload,
      });
    });
    participantsChannel.on("participant_removed", (payload) => {
      this.handleEvent({
        type: "participant_removed",
        roomId,
        payload: payload as ParticipantRemovedPayload,
      });
    });

    // Join both channels
    await Promise.all([
      new Promise<void>((resolve, reject) => {
        chatChannel
          .join()
          .receive("ok", () => resolve())
          .receive("error", (reason: unknown) =>
            reject(new ThenvoiConnectionError(`Failed to join chat: ${reason}`)),
          )
          .receive("timeout", () =>
            reject(new ThenvoiConnectionError("Timeout joining chat channel")),
          );
      }),
      new Promise<void>((resolve, reject) => {
        participantsChannel
          .join()
          .receive("ok", () => resolve())
          .receive("error", (reason: unknown) =>
            reject(
              new ThenvoiConnectionError(`Failed to join participants: ${reason}`),
            ),
          )
          .receive("timeout", () =>
            reject(
              new ThenvoiConnectionError("Timeout joining participants channel"),
            ),
          );
      }),
    ]);

    this.roomChannels.set(roomId, {
      chat: chatChannel,
      participants: participantsChannel,
    });
  }

  private leaveRoomChannels(roomId: string): void {
    const channels = this.roomChannels.get(roomId);
    if (channels) {
      channels.chat.leave();
      channels.participants.leave();
      this.roomChannels.delete(roomId);
    }
  }

  // ===========================================================================
  // Event Handling
  // ===========================================================================

  private handleEvent(event: ThenvoiEvent): void {
    switch (event.type) {
      case "room_added":
        this.handleRoomAdded(event.payload);
        break;

      case "room_removed":
        this.handleRoomRemoved(event.payload);
        break;

      case "message_created":
        // Handle async message processing without blocking the event loop
        this.handleMessageCreated(event.roomId, event.payload).catch((error) => {
          this.callbacks.onError?.(error as Error);
        });
        break;

      case "participant_added":
        this.handleParticipantAdded(event.roomId, event.payload);
        break;

      case "participant_removed":
        this.handleParticipantRemoved(event.roomId, event.payload);
        break;
    }
  }

  private async handleRoomAdded(payload: RoomAddedPayload): Promise<void> {
    const roomId = payload.id;

    // Initialize room state
    this.rooms.set(roomId, {
      roomId,
      title: payload.title,
      participants: [],
      joinedAt: new Date(),
    });

    // Join room channels
    try {
      await this.joinRoomChannels(roomId);
      this.callbacks.onRoomJoined?.(roomId, payload.title);
    } catch (error) {
      this.callbacks.onError?.(error as Error);
      this.rooms.delete(roomId);
    }
  }

  private handleRoomRemoved(payload: RoomRemovedPayload): void {
    const roomId = payload.id;

    // Leave room channels
    this.leaveRoomChannels(roomId);

    // Clean up state
    this.rooms.delete(roomId);

    this.callbacks.onRoomLeft?.(roomId);
  }

  private async handleMessageCreated(
    roomId: string,
    payload: MessageCreatedPayload,
  ): Promise<void> {
    // Debug: log raw payload to understand structure
    console.log("[thenvoi] Raw message payload:", JSON.stringify(payload, null, 2));

    // Record sync point on first WebSocket message
    if (this.syncPointMessageId === null) {
      this.syncPointMessageId = payload.id;
      console.log(`[thenvoi] Sync point set to message ${payload.id}`);
    }

    // Skip our own messages (must call processing before processed per API spec)
    if (payload.sender_id === this.config.agentId) {
      console.log(`[thenvoi] Skipping own message ${payload.id}`);
      try {
        await this.client.markMessageProcessing(roomId, payload.id);
        await this.client.markMessageProcessed(roomId, payload.id);
      } catch {
        // Ignore errors - message may already be processed
      }
      return;
    }

    // Skip non-text messages (must call processing before processed per API spec)
    if (payload.message_type !== "text") {
      console.log(`[thenvoi] Skipping non-text message ${payload.id} (type: ${payload.message_type})`);
      try {
        await this.client.markMessageProcessing(roomId, payload.id);
        await this.client.markMessageProcessed(roomId, payload.id);
      } catch {
        // Ignore errors - message may already be processed
      }
      return;
    }

    // Skip if already processed (deduplication during sync)
    if (this.processedMessageIds.has(payload.id)) {
      console.log(`[thenvoi] Skipping already processed message ${payload.id}`);
      return;
    }

    // If synchronizing, queue the message for processing after sync completes
    // (like Python SDK does - don't skip, just defer)
    if (this.isSynchronizing) {
      console.log(`[thenvoi] Queueing message ${payload.id} during sync (will process after sync)`);
      this.pendingWsMessages.push({ roomId, payload });
      return;
    }

    // Process the message using the shared method
    try {
      await this.processWsMessage(roomId, payload);
    } catch (_error) {
      // Error already logged in processWsMessage
    }
  }

  private handleParticipantAdded(
    roomId: string,
    payload: ParticipantAddedPayload,
  ): void {
    const room = this.rooms.get(roomId);
    if (room) {
      room.participants.push({
        id: payload.id,
        name: payload.name,
        type: payload.type,
        role: payload.role,
      });
    }

    this.callbacks.onParticipantJoined?.(roomId, payload.name);
  }

  private handleParticipantRemoved(
    roomId: string,
    payload: ParticipantRemovedPayload,
  ): void {
    const room = this.rooms.get(roomId);
    if (room) {
      room.participants = room.participants.filter(
        (p) => p.name !== payload.name,
      );
    }

    this.callbacks.onParticipantLeft?.(roomId, payload.name);
  }

  // ===========================================================================
  // Contact Event Handling
  // ===========================================================================

  /**
   * Set up contact event handling based on config.
   */
  private async setupContactHandling(): Promise<void> {
    const strategy = this.contactConfig.strategy ?? "disabled";

    if (strategy === "disabled" && !this.contactConfig.broadcastChanges) {
      console.log("[thenvoi] Contact handling disabled");
      return;
    }

    // Create handler with callbacks
    this.contactEventHandler = new ContactEventHandler({
      config: this.contactConfig,
      client: this.client,
      onBroadcast: this.contactConfig.broadcastChanges
        ? (msg) => this.queueContactBroadcast(msg)
        : undefined,
      onDispatch: strategy === "direct"
        ? (threadId, payload) => this.dispatchContactEvent(threadId, payload)
        : undefined,
    });

    console.log(
      `[thenvoi] Contact handling enabled: strategy=${strategy}, broadcast=${this.contactConfig.broadcastChanges ?? false}`,
    );

    // Process any pending contact requests on startup
    if (strategy === "callback" && this.contactConfig.onEvent) {
      await this.processPendingContactRequests();
    } else if (strategy === "direct") {
      await this.processPendingContactRequestsDirect();
    }
  }

  /**
   * Fetch and process pending contact requests on startup.
   * This handles requests that arrived before the agent was running.
   */
  private async processPendingContactRequests(): Promise<void> {
    try {
      console.log("[thenvoi] Checking for pending contact requests...");
      const response = await this.client.listContactRequests(1, 100, "pending");

      const pendingReceived = response.received || [];
      if (pendingReceived.length === 0) {
        console.log("[thenvoi] No pending contact requests to process");
        return;
      }

      console.log(`[thenvoi] Found ${pendingReceived.length} pending contact requests`);

      // Process each pending request through the callback
      for (const request of pendingReceived) {
        console.log(`[thenvoi] Processing pending request from ${request.from_handle} (${request.id})`);

        // Create a synthetic contact event for the callback
        const event: ContactEvent = {
          type: "contact_request_received",
          payload: {
            id: request.id,
            from_handle: request.from_handle,
            from_name: request.from_name,
            message: request.message,
            status: request.status,
            inserted_at: request.inserted_at ?? new Date().toISOString(),
          },
        };

        // Call the configured callback
        try {
          await this.contactConfig.onEvent!(event);
        } catch (error) {
          console.error(`[thenvoi] Error processing pending request ${request.id}:`, error);
        }
      }

      console.log(`[thenvoi] Finished processing ${pendingReceived.length} pending contact requests`);
    } catch (error) {
      console.error("[thenvoi] Error fetching pending contact requests:", error);
    }
  }

  /**
   * Queue a broadcast message for contact changes.
   */
  private queueContactBroadcast(message: string): void {
    this.pendingContactBroadcasts.push(message);
  }

  /**
   * Dispatch a contact event directly to the agent.
   */
  private async dispatchContactEvent(threadId: string, payload: MessageCreatedPayload): Promise<void> {
    // Convert to OpenClaw message and deliver
    const message: OpenClawInboundMessage = {
      channelId: "thenvoi",
      threadId,
      senderId: payload.sender_id,
      senderType: payload.sender_type,
      senderName: payload.sender_name,
      text: payload.content,
      timestamp: payload.inserted_at,
      metadata: {
        messageId: payload.id,
        isContactEvent: true,
      },
    };

    this.callbacks.onMessage(message);
  }

  /**
   * Process pending contact requests via the direct strategy.
   * Dispatches each pending request through the contact event handler.
   */
  private async processPendingContactRequestsDirect(): Promise<void> {
    try {
      console.log("[thenvoi] Checking for pending contact requests...");
      const response = await this.client.listContactRequests(1, 100, "pending");

      const pendingReceived = response.received || [];
      if (pendingReceived.length === 0) {
        console.log("[thenvoi] No pending contact requests to process");
        return;
      }

      console.log(`[thenvoi] Found ${pendingReceived.length} pending contact requests`);

      for (const request of pendingReceived) {
        console.log(`[thenvoi] Processing pending request from ${request.from_handle} (${request.id})`);

        const event: ContactEvent = {
          type: "contact_request_received",
          payload: {
            id: request.id,
            from_handle: request.from_handle,
            from_name: request.from_name,
            message: request.message,
            status: request.status,
            inserted_at: request.inserted_at ?? new Date().toISOString(),
          },
        };

        try {
          await this.contactEventHandler!.handle(event);
        } catch (error) {
          console.error(`[thenvoi] Error processing pending request ${request.id}:`, error);
        }
      }

      console.log(`[thenvoi] Finished processing ${pendingReceived.length} pending contact requests`);
    } catch (error) {
      console.error("[thenvoi] Error fetching pending contact requests:", error);
    }
  }

  /**
   * Get pending contact broadcasts and clear the queue.
   */
  getPendingContactBroadcasts(): string[] {
    const messages = [...this.pendingContactBroadcasts];
    this.pendingContactBroadcasts = [];
    return messages;
  }

  /**
   * Get contact event handler statistics.
   */
  getContactHandlerStats(): Record<string, unknown> | null {
    return this.contactEventHandler?.getStats() ?? null;
  }

  private handleContactEvent(event: ContactEvent): void {
    console.log(`[thenvoi] Contact event: ${event.type}`, event.payload);

    // Route through ContactEventHandler if configured
    if (this.contactEventHandler) {
      this.contactEventHandler.handle(event).catch((error) => {
        console.error("[thenvoi] Error handling contact event:", error);
      });
    }

    // Also call the legacy callbacks for backwards compatibility
    switch (event.type) {
      case "contact_request_received":
        this.callbacks.onContactRequestReceived?.(event.payload);
        break;

      case "contact_request_updated":
        this.callbacks.onContactRequestUpdated?.(event.payload);
        break;

      case "contact_added":
        this.callbacks.onContactAdded?.(event.payload);
        break;

      case "contact_removed":
        this.callbacks.onContactRemoved?.(event.payload);
        break;
    }
  }
}
