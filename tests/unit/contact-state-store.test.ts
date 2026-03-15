/**
 * Unit tests for ContactStateStore.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { ContactStateStore } from "../../src/contact-state-store.js";
import type { ContactPersistedState } from "../../src/contact-state-store.js";

// Mock fs modules
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
}));

describe("ContactStateStore", () => {
  let store: ContactStateStore;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
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

      const result = await store.load();
      expect(result).toBeNull();
    });

    it("should return parsed state from file", async () => {
      const state: ContactPersistedState = {
        processedEventKeys: ["key1", "key2"],
        savedAt: "2026-03-08T00:00:00.000Z",
      };
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(state));

      const result = await store.load();
      expect(result).toEqual(state);
    });

    it("should return null when processedEventKeys is missing or not an array", async () => {
      vi.mocked(readFile).mockResolvedValue(JSON.stringify({
        savedAt: "2026-03-08T00:00:00Z",
      }));

      const result = await store.load();
      expect(result).toBeNull();
    });

    it("should return null on parse error", async () => {
      vi.mocked(readFile).mockResolvedValue("not-json");

      const result = await store.load();
      expect(result).toBeNull();
    });

    it("should return null for non-object parsed values", async () => {
      vi.mocked(readFile).mockResolvedValue('"just a string"');

      const result = await store.load();
      expect(result).toBeNull();
    });

    it("should default savedAt to 'unknown' when missing", async () => {
      vi.mocked(readFile).mockResolvedValue(JSON.stringify({
        processedEventKeys: ["key1"],
      }));

      const result = await store.load();
      expect(result).not.toBeNull();
      expect(result!.savedAt).toBe("unknown");
    });
  });

  describe("save", () => {
    it("should debounce writes", async () => {
      store.save({ processedEventKeys: ["key1"] });
      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(writeFile).toHaveBeenCalledTimes(1);
      // Should write to temp file, then rename atomically
      expect(writeFile).toHaveBeenCalledWith(
        "/tmp/test-state.json.tmp",
        expect.any(String),
        "utf-8",
      );
      expect(rename).toHaveBeenCalledWith(
        "/tmp/test-state.json.tmp",
        "/tmp/test-state.json",
      );
    });

    it("should trim dedup keys to max 200", async () => {
      const keys = Array.from({ length: 300 }, (_, i) => `key-${i}`);
      store.save({ processedEventKeys: keys });
      await new Promise((resolve) => setTimeout(resolve, 50));

      const written = JSON.parse(
        vi.mocked(writeFile).mock.calls[0][1] as string,
      ) as ContactPersistedState;
      expect(written.processedEventKeys).toHaveLength(200);
      // Should keep the most recent (last 200)
      expect(written.processedEventKeys[0]).toBe("key-100");
    });

    it("should generate savedAt timestamp automatically", async () => {
      store.save({ processedEventKeys: ["key1"] });
      await new Promise((resolve) => setTimeout(resolve, 50));

      const written = JSON.parse(
        vi.mocked(writeFile).mock.calls[0][1] as string,
      ) as ContactPersistedState;
      expect(written.savedAt).toBeDefined();
      // Should be a valid ISO timestamp
      expect(new Date(written.savedAt).toISOString()).toBe(written.savedAt);
    });

    it("should use atomic write (temp file + rename)", async () => {
      store.save({ processedEventKeys: ["key1"] });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(writeFile).toHaveBeenCalledWith(
        "/tmp/test-state.json.tmp",
        expect.any(String),
        "utf-8",
      );
      expect(rename).toHaveBeenCalledWith(
        "/tmp/test-state.json.tmp",
        "/tmp/test-state.json",
      );
    });

    it("should create directory if needed", async () => {
      store.save({ processedEventKeys: [] });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mkdir).toHaveBeenCalledWith("/tmp", { recursive: true });
    });
  });

  describe("flush", () => {
    it("should write immediately without waiting for debounce", async () => {
      // Use a store with long debounce
      const slowStore = new ContactStateStore("/tmp/test-state.json", 60000);

      slowStore.save({ processedEventKeys: ["key1"] });
      // Flush immediately - should not wait for 60s debounce
      await slowStore.flush();

      expect(writeFile).toHaveBeenCalledTimes(1);
    });

    it("should be safe to call with no pending state", async () => {
      await store.flush();
      expect(writeFile).not.toHaveBeenCalled();
    });

    it("should propagate write errors to caller", async () => {
      vi.mocked(writeFile).mockRejectedValue(new Error("disk full"));

      store.save({ processedEventKeys: ["key1"] });
      await expect(store.flush()).rejects.toThrow("disk full");
    });

    it("should await in-flight debounced write before flushing", async () => {
      // Use 0ms debounce so the debounced write starts immediately
      const raceStore = new ContactStateStore("/tmp/test-state.json", 0);

      // Make rename slow to simulate an in-flight write
      let resolveRename!: () => void;
      const renamePromise = new Promise<void>((resolve) => { resolveRename = resolve; });
      vi.mocked(rename).mockReturnValue(renamePromise as Promise<void>);

      // Trigger a debounced save
      raceStore.save({ processedEventKeys: ["key1"] });

      // Wait for the debounce timer to fire (0ms), starting the write
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Now flush while the write is in flight — flush should wait for it
      const flushPromise = raceStore.flush();

      // Flush should not resolve yet (in-flight write is pending)
      let flushResolved = false;
      void flushPromise.then(() => { flushResolved = true; });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(flushResolved).toBe(false);

      // Resolve the in-flight rename (completing the atomic write)
      resolveRename();
      await flushPromise;

      // Write was called once (the debounced one); flush had no pending state
      expect(writeFile).toHaveBeenCalledTimes(1);
    });
  });
});
