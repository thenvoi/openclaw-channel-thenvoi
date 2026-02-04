/**
 * Test configuration fixtures for Thenvoi channel plugin tests.
 */

import type {
  ThenvoiConfig,
  ThenvoiAccountConfig,
} from "../../src/types.js";

// =============================================================================
// Thenvoi Config Fixtures
// =============================================================================

export const mockThenvoiConfig: ThenvoiConfig = {
  apiKey: "test-api-key-12345",
  agentId: "agent-123",
  wsUrl: "wss://test.thenvoi.com/socket",
  restUrl: "https://test.thenvoi.com",
};

export const mockAccountConfig: ThenvoiAccountConfig = {
  enabled: true,
  apiKey: "test-api-key-12345",
  agentId: "agent-123",
  wsUrl: "wss://test.thenvoi.com/socket",
  restUrl: "https://test.thenvoi.com",
};

export const mockMinimalAccountConfig: ThenvoiAccountConfig = {
  enabled: true,
  // Uses environment variables for apiKey, agentId, wsUrl, restUrl
};

// =============================================================================
// Plugin Config Fixtures
// =============================================================================

export const mockPluginConfig = {
  channels: {
    thenvoi: {
      accounts: {
        default: mockAccountConfig,
        secondary: {
          enabled: true,
          apiKey: "secondary-api-key",
          agentId: "agent-456",
        },
      },
    },
  },
};

export const mockEmptyPluginConfig = {};

export const mockPluginConfigNoAccounts = {
  channels: {
    thenvoi: {},
  },
};
