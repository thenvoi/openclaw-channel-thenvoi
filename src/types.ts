/**
 * TypeScript interfaces for Thenvoi platform integration.
 */

// =============================================================================
// Configuration Types
// =============================================================================

export interface ThenvoiConfig {
  apiKey: string;
  agentId: string;
  wsUrl: string;
  restUrl: string;
}

export interface ThenvoiAccountConfig {
  enabled?: boolean;
  apiKey?: string;
  agentId?: string;
  wsUrl?: string;
  restUrl?: string;
  /**
   * Configuration for contact event handling.
   * Only applicable when contactConfig.strategy is not "disabled".
   */
  contactConfig?: ContactEventConfig;
}

export interface ThenvoiChannelConfig {
  accounts?: Record<string, ThenvoiAccountConfig>;
}

// =============================================================================
// WebSocket Event Types (Phoenix Channels)
// =============================================================================

export interface PhoenixMessage<T = unknown> {
  topic: string;
  event: string;
  payload: T;
  ref: string | null;
}

// =============================================================================
// Message Types
// =============================================================================

export interface MessageMetadata {
  mentions?: Mention[];
  status?: string;
}

export interface Mention {
  id: string;
  name: string;
  type: "User" | "Agent";
}

/**
 * Mention format for API requests.
 * Only requires id and name (without type).
 */
export interface MentionRequest {
  id: string;
  name: string;
}

export interface MessageCreatedPayload {
  id: string;
  content: string;
  message_type: MessageType;
  metadata: MessageMetadata;
  sender_id: string;
  sender_type: SenderType;
  sender_name: string;
  chat_room_id: string;
  thread_id?: string;
  inserted_at: string;
  updated_at: string;
}

export type MessageType =
  | "text"
  | "thought"
  | "error"
  | "task"
  | "tool_call"
  | "tool_result";

export type SenderType = "User" | "Agent" | "System";

// =============================================================================
// Room Types
// =============================================================================

export interface RoomOwner {
  id: string;
  name: string;
  type: SenderType;
}

export interface RoomAddedPayload {
  id: string;
  owner: RoomOwner;
  status: string;
  type: string;
  title: string;
  created_at: string;
  participant_role: ParticipantRole;
}

export interface RoomRemovedPayload {
  id: string;
}

export type ParticipantRole = "owner" | "admin" | "member";

// =============================================================================
// Participant Types
// =============================================================================

export interface Participant {
  id: string;
  name: string;
  type: SenderType;
  role: ParticipantRole;
}

export interface ParticipantAddedPayload {
  id: string;
  name: string;
  type: SenderType;
  role: ParticipantRole;
}

export interface ParticipantRemovedPayload {
  id: string;
  name: string;
}

// =============================================================================
// Agent Types
// =============================================================================

export interface AgentMetadata {
  id: string;
  name: string;
  description: string;
  status: string;
}

// =============================================================================
// Peer Types (for lookup_peers)
// =============================================================================

export interface Peer {
  id: string;
  name: string;
  handle?: string;
  type: SenderType;
  description?: string;
  status?: string;
}

export interface LookupPeersResponse {
  peers: Peer[];
  page: number;
  page_size: number;
  total_count: number;
  has_more: boolean;
}

// =============================================================================
// REST API Request/Response Types
// =============================================================================

export interface SendMessageRequest {
  room_id: string;
  content: string;
  message_type?: MessageType;
  mentions?: string[];
  metadata?: Record<string, unknown>;
}

export interface SendMessageResponse {
  id: string;
  chat_room_id: string;
  recipients: Array<{ id: string; name: string }>;
  success: boolean;
}

export interface SendEventResponse {
  id: string;
  chat_room_id: string;
  message_type: string;
  success: boolean;
}

export interface AddParticipantRequest {
  name: string;
  role?: ParticipantRole;
}

export interface AddParticipantResponse {
  id: string;
  name: string;
  type: SenderType;
  role: ParticipantRole;
}

export interface CreateChatroomRequest {
  task_id?: string;
}

export interface CreateChatroomResponse {
  id: string;
  inserted_at: string;
  updated_at: string;
  task_id?: string;
  title?: string;
}

// =============================================================================
// Room State Management
// =============================================================================

export interface RoomState {
  roomId: string;
  title: string;
  participants: Participant[];
  lastMessageId?: string;
  joinedAt: Date;
}

// =============================================================================
// OpenClaw Channel Types
// =============================================================================

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

export interface OpenClawOutboundMessage {
  text: string;
  threadId: string;
  mentions?: string[];
}

// =============================================================================
// MCP Tool Types
// =============================================================================

export interface LookupPeersParams {
  page?: number;
  page_size?: number;
}

export interface AddParticipantParams {
  room_id: string;
  handle: string;
  role?: ParticipantRole;
}

export interface RemoveParticipantParams {
  room_id: string;
  name: string;
}

export interface GetParticipantsParams {
  room_id: string;
}

export interface CreateChatroomParams {
  task_id?: string;
}

/**
 * Event message types for UI status indicators.
 * - thought: Agent's reasoning process (shows thinking indicator)
 * - error: Error or problem report (shows error indicator)
 * - task: Progress or status update (shows progress indicator)
 * - tool_call: Tool invocation with args (shows tool execution)
 * - tool_result: Tool execution result (shows tool completion)
 */
export type EventMessageType = "thought" | "error" | "task" | "tool_call" | "tool_result";

/**
 * Metadata for tool_call events.
 */
export interface ToolCallMetadata {
  tool_call_id: string;
  name: string;
  args?: Record<string, unknown>;
}

/**
 * Metadata for tool_result events.
 */
export interface ToolResultMetadata {
  tool_call_id: string;
  name: string;
  output?: string;
  error?: string;
}

/**
 * Generic event metadata - can be tool_call, tool_result, or custom data.
 */
export type EventMetadata = ToolCallMetadata | ToolResultMetadata | Record<string, unknown>;

export interface SendEventParams {
  room_id: string;
  content: string;
  message_type: EventMessageType;
  metadata?: EventMetadata;
}

export interface SendMessageParams {
  room_id: string;
  content: string;
  mentions: string[];
}

// =============================================================================
// Event Types (for internal use)
// =============================================================================

export type ThenvoiEvent =
  | { type: "message_created"; roomId: string; payload: MessageCreatedPayload }
  | { type: "room_added"; payload: RoomAddedPayload }
  | { type: "room_removed"; payload: RoomRemovedPayload }
  | { type: "participant_added"; roomId: string; payload: ParticipantAddedPayload }
  | { type: "participant_removed"; roomId: string; payload: ParticipantRemovedPayload };

// =============================================================================
// Error Types
// =============================================================================

export class ThenvoiError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = "ThenvoiError";
  }
}

export class ThenvoiConnectionError extends ThenvoiError {
  constructor(message: string) {
    super(message, "CONNECTION_ERROR");
    this.name = "ThenvoiConnectionError";
  }
}

export class ThenvoiAuthError extends ThenvoiError {
  constructor(message: string) {
    super(message, "AUTH_ERROR", 401);
    this.name = "ThenvoiAuthError";
  }
}

export class ThenvoiRateLimitError extends ThenvoiError {
  constructor(
    message: string,
    public readonly retryAfterMs: number,
  ) {
    super(message, "RATE_LIMIT", 429);
    this.name = "ThenvoiRateLimitError";
  }
}

// =============================================================================
// Message Recovery Types
// =============================================================================

/**
 * Message status for tracking processing state.
 */
export type MessageStatus = "pending" | "processing" | "processed" | "failed";

/**
 * Response from GET /api/agent/next endpoint.
 * Returns the next unprocessed message from the backlog.
 */
export interface NextMessageResponse {
  id: string;
  content: string;
  message_type: MessageType;
  metadata: MessageMetadata;
  sender_id: string;
  sender_type: SenderType;
  sender_name: string;
  chat_room_id: string;
  thread_id?: string;
  inserted_at: string;
  updated_at: string;
  status: MessageStatus;
}

/**
 * Response when no pending messages are available.
 */
export interface NoMessageResponse {
  message: "no_pending_messages";
}

// =============================================================================
// Reconnection Types
// =============================================================================

/**
 * Configuration for reconnection behavior.
 */
export interface ReconnectConfig {
  /** Initial delay in milliseconds before first reconnection attempt */
  baseDelayMs: number;
  /** Maximum delay in milliseconds between reconnection attempts */
  maxDelayMs: number;
  /** Multiplier for exponential backoff */
  multiplier: number;
  /** Jitter factor (0-1) to prevent thundering herd */
  jitterFactor: number;
  /** Maximum number of reconnection attempts before giving up */
  maxAttempts: number;
}

// =============================================================================
// Contact Event Strategy Types
// =============================================================================

/**
 * Strategy for handling contact WebSocket events.
 *
 * - DISABLED: Ignore contact events (default). Use manual "check contacts" workflow.
 * - CALLBACK: Programmatic handling via on_event callback. No LLM involvement.
 * - DIRECT: Dispatch contact events directly to the LLM agent for decision-making.
 */
export type ContactEventStrategy = "disabled" | "callback" | "direct";

/**
 * Callback type for contact event handling.
 */
export type ContactEventCallback = (event: ContactEvent) => void | Promise<void>;

/**
 * Configuration for contact event handling.
 *
 * Composable modes:
 * - CALLBACK + broadcast_changes=true: Programmatic handling + awareness everywhere
 * - DIRECT + broadcast_changes=true: LLM decides + awareness everywhere
 * - DISABLED + broadcast_changes=true: Just awareness, manual handling
 */
export interface ContactEventConfig {
  /**
   * Strategy for handling contact events.
   * @default "disabled"
   */
  strategy?: ContactEventStrategy;

  /**
   * For CALLBACK strategy: programmatic handler function.
   * Required when strategy is "callback".
   */
  onEvent?: ContactEventCallback;

  /**
   * Broadcast contact changes to all room sessions.
   *
   * When true, contact_added/contact_removed events inject system messages
   * into all active sessions, similar to participant updates.
   * Works with any strategy (DISABLED, CALLBACK, DIRECT).
   *
   * @default false
   */
  broadcastChanges?: boolean;
}

// =============================================================================
// Contact Types
// =============================================================================

/**
 * A contact in the agent's contact list.
 */
export interface Contact {
  id: string;
  handle: string;
  name: string;
  type: "User" | "Agent";
  description?: string;
  is_external?: boolean;
  inserted_at?: string;
}

/**
 * A contact request (sent or received).
 */
export interface ContactRequest {
  id: string;
  status: ContactRequestStatus;
  message?: string;
  inserted_at?: string;
}

/**
 * Received contact request with requester info.
 */
export interface ReceivedContactRequest extends ContactRequest {
  from_handle: string;
  from_name: string;
}

/**
 * Sent contact request with recipient info.
 */
export interface SentContactRequest extends ContactRequest {
  to_handle: string;
  to_name: string;
}

export type ContactRequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export type ContactRequestAction = "approve" | "reject" | "cancel";

// =============================================================================
// Contact WebSocket Event Payloads
// =============================================================================

export interface ContactRequestReceivedPayload {
  id: string;
  from_handle: string;
  from_name: string;
  message?: string;
  status: string;
  inserted_at: string;
}

export interface ContactRequestUpdatedPayload {
  id: string;
  status: string;
}

export interface ContactAddedPayload {
  id: string;
  handle: string;
  name: string;
  type: "User" | "Agent";
  description?: string;
  is_external?: boolean;
  inserted_at: string;
}

export interface ContactRemovedPayload {
  id: string;
}

// =============================================================================
// Contact REST API Response Types
// =============================================================================

export interface ListContactsResponse {
  contacts: Contact[];
  metadata: PaginationMetadata;
}

export interface AddContactResponse {
  id: string;
  status: "pending" | "approved";
}

export interface RemoveContactResponse {
  status: "removed";
}

export interface ListContactRequestsResponse {
  received: ReceivedContactRequest[];
  sent: SentContactRequest[];
  metadata: ContactRequestsMetadata;
}

export interface ContactRequestsMetadata {
  page: number;
  page_size: number;
  received: { total: number; total_pages: number };
  sent: { total: number; total_pages: number };
}

export interface RespondContactRequestResponse {
  id: string;
  status: string;
}

// =============================================================================
// Contact MCP Tool Params
// =============================================================================

export interface ListContactsParams {
  page?: number;
  page_size?: number;
}

export interface AddContactParams {
  handle: string;
  message?: string;
}

export interface RemoveContactParams {
  handle?: string;
  contact_id?: string;
}

export interface ListContactRequestsParams {
  page?: number;
  page_size?: number;
  sent_status?: "pending" | "approved" | "rejected" | "cancelled" | "all";
}

export interface RespondContactRequestParams {
  action: ContactRequestAction;
  handle?: string;
  request_id?: string;
}

// =============================================================================
// Common Types
// =============================================================================

export interface PaginationMetadata {
  page: number;
  page_size: number;
  total_count: number;
  total_pages: number;
}

// =============================================================================
// Extended Event Types (with contacts)
// =============================================================================

export type ContactEvent =
  | { type: "contact_request_received"; payload: ContactRequestReceivedPayload }
  | { type: "contact_request_updated"; payload: ContactRequestUpdatedPayload }
  | { type: "contact_added"; payload: ContactAddedPayload }
  | { type: "contact_removed"; payload: ContactRemovedPayload };
