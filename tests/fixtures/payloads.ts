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
