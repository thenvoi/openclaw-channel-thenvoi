/**
 * Test data fixtures for Thenvoi channel plugin tests.
 */

import type {
  AgentMetadata,
  MessageCreatedPayload,
  RoomAddedPayload,
  RoomRemovedPayload,
  ParticipantAddedPayload,
  ParticipantRemovedPayload,
  Participant,
  Peer,
  LookupPeersResponse,
  SendMessageResponse,
  AddParticipantResponse,
  CreateChatroomResponse,
  NextMessageResponse,
  ContactAddedPayload,
  ContactRequestReceivedPayload,
} from "../../src/types.js";

// =============================================================================
// Agent Fixtures
// =============================================================================

export const mockAgentMetadata: AgentMetadata = {
  id: "agent-123",
  name: "Test Agent",
  description: "A test agent for unit testing",
  status: "online",
};

export const mockOtherAgentId = "agent-other-456";

// =============================================================================
// Room Fixtures
// =============================================================================

export const mockRoomAddedPayload: RoomAddedPayload = {
  id: "room-001",
  owner: {
    id: "user-789",
    name: "John Doe",
    type: "User",
  },
  status: "active",
  type: "group",
  title: "Test Room",
  created_at: "2025-01-15T10:00:00Z",
  participant_role: "member",
};

export const mockRoomRemovedPayload: RoomRemovedPayload = {
  id: "room-001",
};

// =============================================================================
// Message Fixtures
// =============================================================================

export const mockMessageCreatedPayload: MessageCreatedPayload = {
  id: "msg-001",
  content: "Hello, world!",
  message_type: "text",
  metadata: {
    mentions: [{ id: "agent-123", name: "Test Agent", type: "Agent" }],
  },
  sender_id: "user-789",
  sender_type: "User",
  sender_name: "John Doe",
  chat_room_id: "room-001",
  inserted_at: "2025-01-15T10:05:00Z",
  updated_at: "2025-01-15T10:05:00Z",
};

export const mockSelfMessagePayload: MessageCreatedPayload = {
  ...mockMessageCreatedPayload,
  id: "msg-002",
  sender_id: "agent-123", // Same as our agent ID
  sender_type: "Agent",
  sender_name: "Test Agent",
};

export const mockToolCallMessagePayload: MessageCreatedPayload = {
  ...mockMessageCreatedPayload,
  id: "msg-003",
  message_type: "tool_call", // Non-text message type
};

export const mockNextMessageResponse: NextMessageResponse = {
  id: "msg-backlog-001",
  content: "Backlog message",
  message_type: "text",
  metadata: {},
  sender_id: "user-789",
  sender_type: "User",
  sender_name: "John Doe",
  chat_room_id: "room-001",
  inserted_at: "2025-01-15T10:00:00Z",
  updated_at: "2025-01-15T10:00:00Z",
  status: "pending",
};

// =============================================================================
// Participant Fixtures
// =============================================================================

export const mockParticipantAddedPayload: ParticipantAddedPayload = {
  id: "participant-001",
  name: "Weather Agent",
  type: "Agent",
  role: "member",
};

export const mockParticipantRemovedPayload: ParticipantRemovedPayload = {
  id: "participant-001",
  name: "Weather Agent",
};

export const mockParticipants: Participant[] = [
  { id: "user-789", name: "John Doe", type: "User", role: "owner" },
  { id: "agent-123", name: "Test Agent", type: "Agent", role: "member" },
];

// =============================================================================
// Peer Fixtures
// =============================================================================

export const mockPeers: Peer[] = [
  {
    id: "agent-weather",
    name: "Weather Agent",
    type: "Agent",
    description: "Provides weather info",
    status: "online",
  },
  {
    id: "agent-stock",
    name: "Stock Agent",
    type: "Agent",
    description: "Provides stock info",
    status: "offline",
  },
  { id: "user-jane", name: "Jane Smith", type: "User", status: "online" },
];

export const mockLookupPeersResponse: LookupPeersResponse = {
  peers: mockPeers,
  page: 1,
  page_size: 50,
  total_count: 3,
  has_more: false,
};

// =============================================================================
// API Response Fixtures
// =============================================================================

export const mockSendMessageResponse: SendMessageResponse = {
  id: "msg-new-001",
  status: "sent",
};

export const mockAddParticipantResponse: AddParticipantResponse = {
  id: "participant-new-001",
  name: "Weather Agent",
  type: "Agent",
  role: "member",
};

export const mockCreateChatroomResponse: CreateChatroomResponse = {
  id: "room-new-001",
  status: "active",
};

// =============================================================================
// Contact Fixtures
// =============================================================================

export const mockContactAddedPayload: ContactAddedPayload = {
  id: "contact-001",
  handle: "@jane.doe",
  name: "Jane Doe",
  type: "User",
  description: "A test user contact",
  is_external: false,
  inserted_at: "2025-01-15T10:00:00Z",
};

export const mockAgentContactAddedPayload: ContactAddedPayload = {
  id: "contact-agent-001",
  handle: "@weather-agent",
  name: "Weather Agent",
  type: "Agent",
  description: "Provides weather information",
  is_external: false,
  inserted_at: "2025-01-15T10:00:00Z",
};

export const mockContactRequestReceivedPayload: ContactRequestReceivedPayload = {
  id: "request-001",
  from_id: "user-jane-123",
  from_handle: "@jane.doe",
  from_name: "Jane Doe",
  from_type: "User",
  message: "Hi, I'd like to connect!",
  inserted_at: "2025-01-15T10:00:00Z",
};
