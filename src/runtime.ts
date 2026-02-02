/**
 * Thenvoi Channel Runtime.
 *
 * Manages WebSocket connection to Thenvoi platform and handles
 * multi-room subscription and event routing.
 */

import { Socket, Channel } from "phoenix";

import type {
  MessageCreatedPayload,
  NextMessageResponse,
  OpenClawInboundMessage,
  ParticipantAddedPayload,
  ParticipantRemovedPayload,
  ReconnectConfig,
  RoomAddedPayload,
  RoomRemovedPayload,
  RoomState,
  ThenvoiConfig,
  ThenvoiEvent,
} from "./types.js";
import { ThenvoiConnectionError } from "./types.js";
import { ThenvoiClient } from "./thenvoi-client.js";

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
}

export class ThenvoiRuntime {
  private readonly config: ThenvoiConfig;
  private readonly callbacks: RuntimeCallbacks;
  private readonly client: ThenvoiClient;

  private socket: Socket | null = null;
  private agentChannel: Channel | null = null;
  private rooms: Map<string, RoomState> = new Map();
  private roomChannels: Map<string, { chat: Channel; participants: Channel }> =
    new Map();

  private connected = false;
  private reconnecting = false;

  // Message recovery state
  private syncPointMessageId: string | null = null;
  private isSynchronizing = false;
  private processedMessageIds: Set<string> = new Set();

  // Reconnection state
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalDisconnect = false;

  private readonly reconnectConfig: ReconnectConfig = {
    baseDelayMs: 1000,
    maxDelayMs: 60000,
    multiplier: 2,
    jitterFactor: 0.1,
    maxAttempts: 10,
  };

  constructor(
    config: ThenvoiConfig,
    callbacks: RuntimeCallbacks,
    client?: ThenvoiClient,
  ) {
    this.config = config;
    this.callbacks = callbacks;
    this.client = client ?? new ThenvoiClient(config);
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
      this.socket = new Socket(this.config.wsUrl, {
        params: {
          token: this.config.apiKey,
          agent_id: this.config.agentId,
        },
      });

      this.setupSocketHandlers();

      this.socket.onOpen(async () => {
        try {
          this.connected = true;
          this.reconnecting = false;
          this.reconnectAttempts = 0;

          // Join agent channel
          await this.joinAgentChannel();

          // Synchronize with backlog
          await this.synchronizeWithBacklog();

          resolve();
        } catch (error) {
          reject(error);
        }
      });

      this.socket.onError((error: unknown) => {
        const err = new ThenvoiConnectionError(
          `WebSocket error: ${String(error)}`,
        );
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
    this.rooms.clear();
  }

  /**
   * Set up socket event handlers.
   */
  private setupSocketHandlers(): void {
    if (!this.socket) return;

    this.socket.onClose(() => {
      this.connected = false;

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
   */
  private calculateReconnectDelay(): number {
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
    this.roomChannels.clear();
    this.syncPointMessageId = null; // Reset sync point for new sync

    // Create new socket
    this.socket = new Socket(this.config.wsUrl, {
      params: {
        token: this.config.apiKey,
        agent_id: this.config.agentId,
      },
    });

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

    // Synchronize with backlog
    await this.synchronizeWithBacklog();

    // Restore room subscriptions
    for (const [roomId, roomState] of roomsToRestore) {
      try {
        await this.joinRoomChannels(roomId);
        // Restore room state
        this.rooms.set(roomId, roomState);
      } catch (error) {
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
      } catch (error) {
        // Log but don't fail - participants will be updated via events
      }
    }
  }

  // ===========================================================================
  // Message Recovery (Sync Point Pattern)
  // ===========================================================================

  /**
   * Synchronize with message backlog using the sync point pattern.
   */
  private async synchronizeWithBacklog(): Promise<void> {
    this.isSynchronizing = true;
    this.callbacks.onSyncStarted?.();

    let processedCount = 0;

    try {
      while (true) {
        const message = await this.client.getNextMessage();

        // No more backlog messages
        if (!message) {
          break;
        }

        // Reached sync point - backlog complete
        if (this.syncPointMessageId && message.id === this.syncPointMessageId) {
          // Still process this message as it's the first WS message we received
          await this.processBacklogMessage(message);
          processedCount++;
          break;
        }

        // Skip own messages
        if (message.sender_id === this.config.agentId) {
          await this.client.markMessageProcessed(message.chat_room_id, message.id);
          continue;
        }

        // Skip non-text messages
        if (message.message_type !== "text") {
          await this.client.markMessageProcessed(message.chat_room_id, message.id);
          continue;
        }

        // Process the backlog message
        await this.processBacklogMessage(message);
        processedCount++;
      }

      this.callbacks.onSyncCompleted?.(processedCount);
    } catch (error) {
      this.callbacks.onSyncError?.(error as Error);
      throw error;
    } finally {
      this.isSynchronizing = false;
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

    const topic = `agent:rooms`;
    this.agentChannel = this.socket.channel(topic, {
      agent_id: this.config.agentId,
    });

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
        this.handleMessageCreated(event.roomId, event.payload);
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

  private handleMessageCreated(
    roomId: string,
    payload: MessageCreatedPayload,
  ): void {
    // Record sync point on first WebSocket message
    if (this.syncPointMessageId === null) {
      this.syncPointMessageId = payload.id;
    }

    // Skip our own messages
    if (payload.sender_id === this.config.agentId) {
      return;
    }

    // Skip non-text messages (tool_call, tool_result, etc.)
    if (payload.message_type !== "text") {
      return;
    }

    // Skip if already processed (deduplication during sync)
    if (this.processedMessageIds.has(payload.id)) {
      return;
    }

    // If synchronizing, skip - messages will be processed via REST
    if (this.isSynchronizing) {
      return;
    }

    // Update room state
    const room = this.rooms.get(roomId);
    if (room) {
      room.lastMessageId = payload.id;
    }

    // Mark as processed
    this.processedMessageIds.add(payload.id);

    // Convert to OpenClaw format and deliver
    const message: OpenClawInboundMessage = {
      channelId: "thenvoi",
      threadId: roomId,
      senderId: payload.sender_id,
      senderType: payload.sender_type,
      senderName: payload.sender_name,
      text: payload.content,
      timestamp: payload.inserted_at,
      metadata: {
        messageId: payload.id,
        mentions: payload.metadata?.mentions,
      },
    };

    this.callbacks.onMessage(message);
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
}
