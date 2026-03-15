/**
 * ContactStateStore - File-based persistence for contact event state.
 *
 * Persists dedup cache so it survives restarts.
 * Uses a JSON file stored at a configurable path.
 */

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";

/** Shape of the persisted state file. */
export interface ContactPersistedState {
  /** Dedup cache keys (bounded subset of recent entries). */
  processedEventKeys: string[];
  /** Request cache entries for enriching update events. */
  requestCache?: Array<{ key: string; value: Record<string, string | undefined> }>;
  /** Broadcast messages queued but not yet delivered. */
  pendingBroadcasts?: string[];
  /** ISO timestamp of last save. */
  savedAt: string;
}

/** Maximum number of dedup keys to persist (matches in-memory MAX_DEDUP_CACHE_SIZE). */
const MAX_PERSISTED_DEDUP_KEYS = 1000;

/** Default debounce interval for writes (ms). */
const DEFAULT_DEBOUNCE_MS = 1000;

export class ContactStateStore {
  private readonly filePath: string;
  private readonly debounceMs: number;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingState: ContactPersistedState | null = null;
  /** Tracks the in-flight write so flush() can await it. */
  private inflightWrite: Promise<void> = Promise.resolve();

  constructor(filePath: string, debounceMs: number = DEFAULT_DEBOUNCE_MS) {
    this.filePath = filePath;
    this.debounceMs = debounceMs;
  }

  /**
   * Load persisted state from disk.
   * Returns null if file doesn't exist or is invalid.
   */
  async load(): Promise<ContactPersistedState | null> {
    try {
      const data = await readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(data) as ContactPersistedState;

      // Validate required fields
      // Note: `typeof null === "object"` in JS, so the explicit null check is necessary
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !Array.isArray(parsed.processedEventKeys)
      ) {
        console.warn("[thenvoi:state] Invalid state file format, ignoring");
        return null;
      }

      // Ensure savedAt is a valid string (may be missing in older state files)
      if (typeof parsed.savedAt !== "string") {
        parsed.savedAt = "unknown";
      }

      // Sanitize optional fields — treat unexpected types as missing
      if (parsed.requestCache !== undefined && !Array.isArray(parsed.requestCache)) {
        parsed.requestCache = undefined;
      }
      if (parsed.pendingBroadcasts !== undefined && !Array.isArray(parsed.pendingBroadcasts)) {
        parsed.pendingBroadcasts = undefined;
      }

      console.log(
        `[thenvoi:state] Loaded state: dedupKeys=${parsed.processedEventKeys.length}, ` +
        `savedAt=${parsed.savedAt}`,
      );
      return parsed;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        console.log("[thenvoi:state] No persisted state file found, starting fresh");
        return null;
      }
      console.warn("[thenvoi:state] Failed to load state file:", error);
      return null;
    }
  }

  /**
   * Save state to disk (debounced).
   * Multiple rapid calls will be coalesced into a single write.
   * The store generates the `savedAt` timestamp automatically.
   */
  save(state: Omit<ContactPersistedState, "savedAt">): void {
    // Trim caches to bounded size (keep most recent)
    const trimmedState: ContactPersistedState = {
      ...state,
      processedEventKeys: state.processedEventKeys.slice(-MAX_PERSISTED_DEDUP_KEYS),
      requestCache: state.requestCache?.slice(-MAX_PERSISTED_DEDUP_KEYS),
      savedAt: new Date().toISOString(),
    };

    this.pendingState = trimmedState;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.writeToDisk();
    }, this.debounceMs);
  }

  /**
   * Flush any pending writes immediately.
   * Unlike debounced saves, this propagates write errors to the caller.
   */
  async flush(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    // Wait for any in-flight debounced write to complete before flushing
    // remaining state. Without this, flush() could return before a concurrent
    // writeToDisk() finishes, losing the final state on shutdown.
    await this.inflightWrite;
    await this.writeToDisk(true);
  }

  /**
   * Write the pending state to disk.
   * @param propagateErrors - When true (flush path), re-throw after logging.
   *   When false (debounced path), swallow errors since there's no caller to handle them.
   */
  private async writeToDisk(propagateErrors = false): Promise<void> {
    if (!this.pendingState) {
      return;
    }

    const state = this.pendingState;
    this.pendingState = null;

    const write = (async () => {
      try {
        // Ensure directory exists
        await mkdir(dirname(this.filePath), { recursive: true });
        // Atomic write: write to temp file, then rename to avoid corruption on crash
        const tmpPath = this.filePath + ".tmp";
        await writeFile(tmpPath, JSON.stringify(state, null, 2), "utf-8");
        await rename(tmpPath, this.filePath);
        console.log(`[thenvoi:state] State saved (dedupKeys=${state.processedEventKeys.length})`);
      } catch (error) {
        console.error("[thenvoi:state] Failed to save state:", error);
        if (propagateErrors) {
          throw error;
        }
      }
    })();

    this.inflightWrite = write;
    await write;
  }
}
