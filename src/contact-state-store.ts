/**
 * ContactStateStore - File-based persistence for contact event state.
 *
 * Persists dedup cache so it survives restarts.
 * Uses a JSON file stored at a configurable path.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

/** Shape of the persisted state file. */
export interface ContactPersistedState {
  /** Dedup cache keys (bounded subset of recent entries). */
  processedEventKeys: string[];
  /** ISO timestamp of last save. */
  savedAt: string;
}

/** Maximum number of dedup keys to persist. */
const MAX_PERSISTED_DEDUP_KEYS = 200;

/** Default debounce interval for writes (ms). */
const DEFAULT_DEBOUNCE_MS = 1000;

export class ContactStateStore {
  private readonly filePath: string;
  private readonly debounceMs: number;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingState: ContactPersistedState | null = null;

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
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !Array.isArray(parsed.processedEventKeys)
      ) {
        console.warn("[thenvoi:state] Invalid state file format, ignoring");
        return null;
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
   */
  save(state: ContactPersistedState): void {
    // Trim dedup keys to bounded size (keep most recent)
    const trimmedState: ContactPersistedState = {
      ...state,
      processedEventKeys: state.processedEventKeys.slice(-MAX_PERSISTED_DEDUP_KEYS),
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
   * Call this on shutdown to avoid losing state.
   */
  async flush(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    await this.writeToDisk();
  }

  /**
   * Write the pending state to disk.
   */
  private async writeToDisk(): Promise<void> {
    if (!this.pendingState) {
      return;
    }

    const state = this.pendingState;
    this.pendingState = null;

    try {
      // Ensure directory exists
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, JSON.stringify(state, null, 2), "utf-8");
      console.log(`[thenvoi:state] State saved (dedupKeys=${state.processedEventKeys.length})`);
    } catch (error) {
      console.error("[thenvoi:state] Failed to save state:", error);
    }
  }
}
