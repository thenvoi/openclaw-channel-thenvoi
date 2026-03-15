/**
 * Unit tests for ContactStateStore.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { ContactStateStore } from "../../src/contact-state-store.js";
import type { ContactPersistedState } from "../../src/contact-state-store.js";

// Mock fs modules
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

describe("ContactStateStore", () => {
  let store: ContactStateStore;

  beforeEach(() => {
    vi.clearAllMocks();
    // Use 0ms debounce for tests
    store = new ContactStateStore("/tmp/test-state.json", 0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("load", () => {
    it("should return null when file does not exist", async () => {
      const err = new Error("ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      vi.mocked(readFile).mockRejectedValue(err);
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const result = await store.load();
      expect(result).toBeNull();

      consoleSpy.mockRestore();
    });

    it("should return parsed state from file", async () => {
      const state: ContactPersistedState = {
        processedEventKeys: ["key1", "key2"],
        savedAt: "2026-03-08T00:00:00.000Z",
      };
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(state));
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const result = await store.load();
      expect(result).toEqual(state);

      consoleSpy.mockRestore();
    });

    it("should return null when processedEventKeys is missing or not an array", async () => {
      vi.mocked(readFile).mockResolvedValue(JSON.stringify({
        savedAt: "2026-03-08T00:00:00Z",
      }));
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await store.load();
      expect(result).toBeNull();

      consoleSpy.mockRestore();
    });

    it("should return null on parse error", async () => {
      vi.mocked(readFile).mockResolvedValue("not-json");
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await store.load();
      expect(result).toBeNull();

      consoleSpy.mockRestore();
    });

    it("should return null for non-object parsed values", async () => {
      vi.mocked(readFile).mockResolvedValue('"just a string"');
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await store.load();
      expect(result).toBeNull();

      consoleSpy.mockRestore();
    });
  });

  describe("save", () => {
    it("should debounce writes", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const state: ContactPersistedState = {
        processedEventKeys: ["key1"],
        savedAt: "2026-03-08T00:00:00Z",
      };

      store.save(state);
      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(writeFile).toHaveBeenCalledTimes(1);
      consoleSpy.mockRestore();
    });

    it("should trim dedup keys to max 200", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const keys = Array.from({ length: 300 }, (_, i) => `key-${i}`);
      const state: ContactPersistedState = {
        processedEventKeys: keys,
        savedAt: "2026-03-08T00:00:00Z",
      };

      store.save(state);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const written = JSON.parse(
        vi.mocked(writeFile).mock.calls[0][1] as string,
      ) as ContactPersistedState;
      expect(written.processedEventKeys).toHaveLength(200);
      // Should keep the most recent (last 200)
      expect(written.processedEventKeys[0]).toBe("key-100");

      consoleSpy.mockRestore();
    });

    it("should create directory if needed", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const state: ContactPersistedState = {
        processedEventKeys: [],
        savedAt: "2026-03-08T00:00:00Z",
      };

      store.save(state);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mkdir).toHaveBeenCalledWith("/tmp", { recursive: true });
      consoleSpy.mockRestore();
    });
  });

  describe("flush", () => {
    it("should write immediately without waiting for debounce", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      // Use a store with long debounce
      const slowStore = new ContactStateStore("/tmp/test-state.json", 60000);
      const state: ContactPersistedState = {
        processedEventKeys: ["key1"],
        savedAt: "2026-03-08T00:00:00Z",
      };

      slowStore.save(state);
      // Flush immediately - should not wait for 60s debounce
      await slowStore.flush();

      expect(writeFile).toHaveBeenCalledTimes(1);
      consoleSpy.mockRestore();
    });

    it("should be safe to call with no pending state", async () => {
      await store.flush();
      expect(writeFile).not.toHaveBeenCalled();
    });
  });
});
