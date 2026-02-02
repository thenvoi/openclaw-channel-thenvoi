/**
 * Fetch mock helpers for testing.
 */

import { vi, type Mock } from "vitest";

interface FetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

export interface MockFetchConfig {
  response?: unknown;
  status?: number;
  ok?: boolean;
  error?: Error;
  textResponse?: string;
}

/**
 * Create a mock fetch function with a default response.
 */
export function createMockFetch(config: MockFetchConfig = {}): Mock {
  return vi.fn(
    async (_url: string, _options?: RequestInit): Promise<FetchResponse> => {
      if (config.error) {
        throw config.error;
      }

      const status = config.status ?? 200;
      const ok = config.ok ?? (status >= 200 && status < 300);

      return {
        ok,
        status,
        statusText: ok ? "OK" : "Error",
        json: async () => config.response ?? {},
        text: async () =>
          config.textResponse ?? JSON.stringify(config.response ?? {}),
      };
    },
  );
}

/**
 * Configure a mock fetch to return a specific response on the next call.
 */
export function mockFetchOnce(fetchMock: Mock, config: MockFetchConfig): void {
  fetchMock.mockImplementationOnce(async () => {
    if (config.error) {
      throw config.error;
    }

    const status = config.status ?? 200;
    const ok = config.ok ?? (status >= 200 && status < 300);

    return {
      ok,
      status,
      statusText: ok ? "OK" : "Error",
      json: async () => config.response ?? {},
      text: async () =>
        config.textResponse ?? JSON.stringify(config.response ?? {}),
    };
  });
}

/**
 * Create a mock fetch that returns responses in sequence.
 */
export function createMockFetchSequence(configs: MockFetchConfig[]): Mock {
  const mock = vi.fn();

  configs.forEach((config) => {
    mockFetchOnce(mock, config);
  });

  return mock;
}

/**
 * Create a URL-based mock fetch that returns different responses based on URL.
 */
export function createMockFetchByUrl(
  urlConfigs: Map<string, MockFetchConfig>,
  defaultConfig: MockFetchConfig = {},
): Mock {
  return vi.fn(
    async (url: string, _options?: RequestInit): Promise<FetchResponse> => {
      const config = urlConfigs.get(url) ?? defaultConfig;

      if (config.error) {
        throw config.error;
      }

      const status = config.status ?? 200;
      const ok = config.ok ?? (status >= 200 && status < 300);

      return {
        ok,
        status,
        statusText: ok ? "OK" : "Error",
        json: async () => config.response ?? {},
        text: async () =>
          config.textResponse ?? JSON.stringify(config.response ?? {}),
      };
    },
  );
}
