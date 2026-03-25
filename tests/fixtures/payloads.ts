/**
 * Test data fixtures for Thenvoi channel plugin tests.
 * Uses plain objects instead of importing SDK types.
 */

// =============================================================================
// Agent Fixtures
// =============================================================================

export const mockAgentMetadata = {
  id: "agent-123",
  name: "Test Agent",
  description: "A test agent for unit testing",
  handle: "@test-agent",
};

export const mockOtherAgentId = "agent-other-456";

// =============================================================================
// Participant Fixtures
// =============================================================================

export const mockParticipants = [
  { id: "user-789", name: "John Doe", type: "User", handle: "@john" },
  { id: "agent-123", name: "Test Agent", type: "Agent", handle: "@test-agent" },
];

// =============================================================================
// Peer Fixtures (SDK PeerRecord shape)
// =============================================================================

export const mockPeers = [
  {
    id: "agent-weather",
    name: "Weather Agent",
    type: "Agent",
    handle: "@weather-agent",
    description: "Provides weather info",
  },
  {
    id: "agent-stock",
    name: "Stock Agent",
    type: "Agent",
    handle: "@stock-agent",
    description: "Provides stock info",
  },
  { id: "user-jane", name: "Jane Smith", type: "User", handle: "@jane" },
];

// SDK listPeers returns PaginatedResponse<PeerRecord>
export const mockLookupPeersResponse = {
  data: mockPeers,
  metadata: {
    page: 1,
    pageSize: 50,
    totalCount: 3,
    totalPages: 1,
  },
};

// =============================================================================
// API Response Fixtures (SDK ToolOperationResult shape)
// =============================================================================

export const mockSendMessageResponse = {
  ok: true,
  id: "msg-new-001",
};

export const mockAddParticipantResponse = {
  ok: true,
  id: "participant-new-001",
  name: "Weather Agent",
  type: "Agent",
  role: "member",
};

export const mockCreateChatroomResponse = {
  id: "room-new-001",
};

// =============================================================================
// Contact Fixtures
// =============================================================================

export const mockContacts = [
  { id: "contact-001", handle: "@jane", name: "Jane Smith", type: "User" },
  { id: "contact-002", handle: "@weather-agent", name: "Weather Agent", type: "Agent" },
];

export const mockListContactsResponse = {
  data: mockContacts,
  metadata: {
    page: 1,
    pageSize: 50,
    totalCount: 2,
    totalPages: 1,
  },
};

export const mockAddContactResponse = {
  id: "request-001",
  status: "pending",
  to_handle: "@jane",
};

export const mockListContactRequestsResponse = {
  received: [
    {
      id: "req-recv-001",
      from_handle: "@alice",
      from_name: "Alice",
      message: "Hi, let's connect!",
      status: "pending",
    },
  ],
  sent: [
    {
      id: "req-sent-001",
      to_handle: "@bob",
      to_name: "Bob",
      message: "Want to collaborate?",
      status: "pending",
    },
  ],
  metadata: {
    page: 1,
    pageSize: 50,
    totalCount: 2,
    totalPages: 1,
  },
};

export const mockRespondContactRequestResponse = {
  id: "req-recv-001",
  status: "approved",
};
