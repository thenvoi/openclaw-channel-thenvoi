/**
 * ContactEventHandler - Handles contact WebSocket events.
 *
 * Routes events based on ContactEventConfig strategy:
 * - DISABLED: Ignores all contact events
 * - CALLBACK: Calls programmatic callback
 * - HUB_ROOM: Routes to dedicated hub room for LLM reasoning
 *
 * Ported from thenvoi-sdk-python/src/thenvoi/runtime/contact_handler.py
 */

import type { ThenvoiClient } from "./thenvoi-client.js";
import type {
  ContactEvent,
  ContactEventConfig,
  ContactRequestReceivedPayload,
  MessageCreatedPayload,
} from "./types.js";
import { HUB_ROOM_SYSTEM_PROMPT } from "./prompts.js";

// Maximum size of deduplication cache
const MAX_DEDUP_CACHE_SIZE = 1000;

/**
 * Callback to inject a message event into the hub room.
 */
export type HubEventCallback = (roomId: string, payload: MessageCreatedPayload) => void | Promise<void>;

/**
 * Callback to inject system prompt when hub room is first used.
 */
export type HubInitCallback = (roomId: string, prompt: string) => void | Promise<void>;

/**
 * Callback to broadcast contact changes to all sessions.
 */
export type BroadcastCallback = (message: string) => void;

export interface ContactEventHandlerOptions {
  config: ContactEventConfig;
  client: ThenvoiClient;
  onBroadcast?: BroadcastCallback;
  onHubEvent?: HubEventCallback;
  onHubInit?: HubInitCallback;
}

/**
 * Handles contact WebSocket events based on strategy.
 *
 * Operates at agent level (not per-room) to avoid race conditions
 * when agent is in multiple rooms simultaneously.
 */
export class ContactEventHandler {
  private readonly config: ContactEventConfig;
  private readonly client: ThenvoiClient;
  private readonly onBroadcast?: BroadcastCallback;
  private readonly onHubEvent?: HubEventCallback;
  private readonly onHubInit?: HubInitCallback;

  // Deduplication cache: event key -> processed flag
  private readonly processedEvents: Map<string, boolean> = new Map();

  // Hub room ID (for HUB_ROOM strategy)
  private hubRoomId: string | null = null;

  // Whether hub room has been initialized with system prompt
  private hubRoomInitialized = false;

  // Cache for contact request info (request_id -> {from_handle, from_name, message})
  // Used to enrich ContactRequestUpdatedEvent with sender info
  private readonly requestCache: Map<string, Record<string, string | undefined>> = new Map();

  constructor(options: ContactEventHandlerOptions) {
    this.config = options.config;
    this.client = options.client;
    this.onBroadcast = options.onBroadcast;
    this.onHubEvent = options.onHubEvent;
    this.onHubInit = options.onHubInit;
  }

  /**
   * Get the hub room ID if created.
   */
  getHubRoomId(): string | null {
    return this.hubRoomId;
  }

  /**
   * Initialize hub room at startup (for HUB_ROOM strategy).
   *
   * Creates the hub room via REST. The room_added WebSocket event
   * will trigger room channel subscription.
   */
  async initializeHubRoom(): Promise<string> {
    if (this.hubRoomId !== null) {
      return this.hubRoomId;
    }

    console.log(
      `[thenvoi] Creating hub room for contact events (task_id=${this.config.hubTaskId ?? "none"})`,
    );

    const response = await this.client.createChat(this.config.hubTaskId);
    this.hubRoomId = response.id;

    console.log(`[thenvoi] Hub room created: ${this.hubRoomId}`);
    return this.hubRoomId;
  }

  /**
   * Handle a contact event based on configured strategy.
   */
  async handle(event: ContactEvent): Promise<void> {
    const strategy = this.config.strategy ?? "disabled";

    console.log(`[thenvoi] ContactEventHandler.handle: ${event.type} (strategy=${strategy})`);

    // Skip if already processed (deduplication)
    if (this.shouldSkipDuplicate(event)) {
      console.log(`[thenvoi] Skipping duplicate contact event: ${this.getDedupKey(event)}`);
      return;
    }

    // Cache request info for later enrichment of update events
    this.cacheRequestInfo(event);

    // Handle broadcast if enabled (for contact_added/contact_removed)
    if (this.config.broadcastChanges) {
      this.maybeBroadcast(event);
    }

    // Route based on strategy
    let success = true;

    switch (strategy) {
      case "disabled":
        console.log("[thenvoi] Contact event ignored (strategy=disabled)");
        return;

      case "callback":
        success = await this.handleCallback(event);
        break;

      case "hub_room":
        success = await this.handleHubRoom(event);
        break;
    }

    // Mark as processed only after successful handling
    if (success) {
      this.markProcessed(event);
    }
  }

  /**
   * Handle event via CALLBACK strategy.
   */
  private async handleCallback(event: ContactEvent): Promise<boolean> {
    if (!this.config.onEvent) {
      console.warn("[thenvoi] CALLBACK strategy but no onEvent callback configured");
      return true; // Not a failure, just misconfigured
    }

    try {
      console.log(`[thenvoi] Calling contact event callback for ${event.type}`);
      await this.config.onEvent(event);
      console.log("[thenvoi] Contact event callback completed successfully");
      return true;
    } catch (error) {
      console.error("[thenvoi] Contact event callback failed:", error);
      return false;
    }
  }

  /**
   * Handle event via HUB_ROOM strategy.
   *
   * Routes event to dedicated hub room for LLM reasoning.
   */
  private async handleHubRoom(event: ContactEvent): Promise<boolean> {
    if (!this.onHubEvent) {
      console.warn("[thenvoi] HUB_ROOM strategy but no onHubEvent callback configured");
      return false;
    }

    if (!this.hubRoomId) {
      console.error("[thenvoi] Hub room not initialized - call initializeHubRoom() first");
      return false;
    }

    try {
      const hubId = this.hubRoomId;

      // Inject system prompt on first use
      if (!this.hubRoomInitialized && this.onHubInit) {
        console.log("[thenvoi] Initializing hub room with system prompt");
        await this.onHubInit(hubId, HUB_ROOM_SYSTEM_PROMPT);
        this.hubRoomInitialized = true;
      }

      // Format event as a message for LLM processing
      const content = await this.formatEventForRoom(event);
      const eventType = this.getEventType(event);

      // Create synthetic MessageCreatedPayload for hub room
      const now = new Date().toISOString();
      const payload: MessageCreatedPayload = {
        id: crypto.randomUUID(),
        content,
        message_type: "text",
        sender_type: "System",
        sender_id: "contact-events",
        sender_name: "Contact Events",
        metadata: {},
        chat_room_id: hubId,
        inserted_at: now,
        updated_at: now,
      };

      // Push to hub room (triggers agent processing)
      console.log(`[thenvoi] Injecting contact event to hub room ${hubId}: ${eventType}`);
      await this.onHubEvent(hubId, payload);

      // Also POST as task event to room for persistence/visibility
      await this.postTaskEvent(hubId, content, eventType);

      console.log("[thenvoi] Contact event injected to hub room successfully");
      return true;
    } catch (error) {
      console.error("[thenvoi] Failed to inject contact event to hub room:", error);
      return false;
    }
  }

  /**
   * Post contact event as task event to room via REST.
   */
  private async postTaskEvent(roomId: string, content: string, eventType: string): Promise<void> {
    try {
      await this.client.sendEvent(roomId, content, "task", { contact_event_type: eventType });
      console.log(`[thenvoi] Task event posted to hub room: ${eventType}`);
    } catch (error) {
      // Log but don't fail - the message injection is the important part
      console.warn("[thenvoi] Failed to post task event to hub room:", error);
    }
  }

  /**
   * Format contact event as human-readable message for hub room.
   */
  private async formatEventForRoom(event: ContactEvent): Promise<string> {
    switch (event.type) {
      case "contact_request_received": {
        const payload = event.payload;
        const fromHandle = payload.from_handle.startsWith("@")
          ? payload.from_handle
          : `@${payload.from_handle}`;
        const msgPart = payload.message ? `\nMessage: "${payload.message}"` : "";
        return (
          `[Contact Request] ${payload.from_name} (${fromHandle}) ` +
          `wants to connect.${msgPart}\n` +
          `Request ID: ${payload.id}`
        );
      }

      case "contact_request_updated": {
        const payload = event.payload;
        // Try to get enriched request info
        const info = await this.enrichUpdateEvent(payload.id);
        if (info) {
          const name = info.from_name ?? info.to_name;
          let handle = info.from_handle ?? info.to_handle ?? "";
          if (handle && !handle.startsWith("@")) {
            handle = `@${handle}`;
          }
          if (name) {
            const direction = info.from_name ? "from" : "to";
            return (
              `[Contact Request Update] Request ${direction} ${name} ` +
              `(${handle}) status changed to: ${payload.status}\n` +
              `Request ID: ${payload.id}`
            );
          }
        }
        return (
          `[Contact Request Update] Request ${payload.id} ` +
          `status changed to: ${payload.status}`
        );
      }

      case "contact_added": {
        const payload = event.payload;
        const handle = payload.handle.startsWith("@")
          ? payload.handle
          : `@${payload.handle}`;
        return (
          `[Contact Added] ${payload.name} (${handle}) ` +
          `is now a contact.\n` +
          `Type: ${payload.type}, ID: ${payload.id}`
        );
      }

      case "contact_removed": {
        const payload = event.payload;
        return `[Contact Removed] Contact ${payload.id} was removed.`;
      }

      default:
        return `[Contact Event] Unknown event type`;
    }
  }

  /**
   * Get the event type name for metadata.
   */
  private getEventType(event: ContactEvent): string {
    return event.type;
  }

  /**
   * Queue broadcast message if applicable.
   */
  private maybeBroadcast(event: ContactEvent): void {
    if (!this.onBroadcast) {
      return;
    }

    switch (event.type) {
      case "contact_added": {
        const payload = event.payload;
        const handle = payload.handle.startsWith("@")
          ? payload.handle
          : `@${payload.handle}`;
        const msg = `${handle} (${payload.name}) is now a contact`;
        this.onBroadcast(msg);
        console.log(`[thenvoi] Queued broadcast: ${msg}`);
        break;
      }

      case "contact_removed": {
        const payload = event.payload;
        const msg = `Contact ${payload.id} was removed`;
        this.onBroadcast(msg);
        console.log(`[thenvoi] Queued broadcast: ${msg}`);
        break;
      }

      default:
        // Don't broadcast request events
        break;
    }
  }

  /**
   * Check if event was already processed.
   */
  private shouldSkipDuplicate(event: ContactEvent): boolean {
    const key = this.getDedupKey(event);
    if (!key) {
      return false;
    }
    return this.processedEvents.has(key);
  }

  /**
   * Get deduplication key for an event.
   */
  private getDedupKey(event: ContactEvent): string | null {
    switch (event.type) {
      case "contact_request_received":
        return `request_received:${event.payload.id}`;

      case "contact_request_updated":
        return `request_updated:${event.payload.id}:${event.payload.status}`;

      case "contact_added":
        return `contact_added:${event.payload.id}`;

      case "contact_removed":
        return `contact_removed:${event.payload.id}`;

      default:
        return null;
    }
  }

  /**
   * Mark event as processed.
   */
  private markProcessed(event: ContactEvent): void {
    const key = this.getDedupKey(event);
    if (!key) {
      return;
    }

    this.processedEvents.set(key, true);

    // Evict oldest entries if cache is too large
    if (this.processedEvents.size > MAX_DEDUP_CACHE_SIZE) {
      const firstKey = this.processedEvents.keys().next().value;
      if (firstKey) {
        this.processedEvents.delete(firstKey);
      }
    }
  }

  /**
   * Cache request info for enriching update events.
   */
  private cacheRequestInfo(event: ContactEvent): void {
    if (event.type !== "contact_request_received") {
      return;
    }

    const payload = event.payload as ContactRequestReceivedPayload;
    this.requestCache.set(payload.id, {
      from_handle: payload.from_handle,
      from_name: payload.from_name,
      message: payload.message,
    });

    // Maintain bounded cache size
    if (this.requestCache.size > MAX_DEDUP_CACHE_SIZE) {
      const firstKey = this.requestCache.keys().next().value;
      if (firstKey) {
        this.requestCache.delete(firstKey);
      }
    }
  }

  /**
   * Get enriched info for an update event.
   */
  private async enrichUpdateEvent(requestId: string): Promise<Record<string, string | undefined> | null> {
    // Try cache first
    const cached = this.requestCache.get(requestId);
    if (cached) {
      return cached;
    }

    // Cache miss - fetch from API
    console.log(`[thenvoi] Cache miss for request ${requestId}, fetching from API`);
    return this.fetchRequestDetails(requestId);
  }

  /**
   * Fetch request details from API when cache misses.
   */
  private async fetchRequestDetails(requestId: string): Promise<Record<string, string | undefined> | null> {
    try {
      const response = await this.client.listContactRequests(1, 100);

      // Check received requests
      for (const req of response.received) {
        if (req.id === requestId) {
          const info = {
            from_handle: req.from_handle,
            from_name: req.from_name,
            message: req.message,
          };
          this.requestCache.set(requestId, info);
          console.log(`[thenvoi] Fetched request details from API (received): ${requestId}`);
          return info;
        }
      }

      // Check sent requests
      for (const req of response.sent) {
        if (req.id === requestId) {
          const info = {
            to_handle: req.to_handle,
            to_name: req.to_name,
            message: req.message,
          };
          this.requestCache.set(requestId, info);
          console.log(`[thenvoi] Fetched request details from API (sent): ${requestId}`);
          return info;
        }
      }

      console.log(`[thenvoi] Request not found in API: ${requestId}`);
      return null;
    } catch (error) {
      console.warn("[thenvoi] Failed to fetch request details from API:", error);
      return null;
    }
  }

  /**
   * Get handler statistics.
   */
  getStats(): Record<string, unknown> {
    return {
      strategy: this.config.strategy ?? "disabled",
      dedupCacheSize: this.processedEvents.size,
      hubRoomId: this.hubRoomId,
      broadcastEnabled: this.config.broadcastChanges ?? false,
    };
  }
}
