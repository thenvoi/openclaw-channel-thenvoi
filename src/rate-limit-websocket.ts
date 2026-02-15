/**
 * Rate-limit aware WebSocket wrapper.
 *
 * Extends the ws WebSocket to detect 429 rate limit responses during
 * the connection handshake and extract Retry-After header values.
 */

import WebSocket from "ws";
import type { ClientRequest, IncomingMessage } from "http";

/**
 * WebSocket wrapper that detects 429 rate limit responses during connection.
 *
 * The ws library emits 'unexpected-response' when the server returns a non-101
 * status code. This wrapper captures 429 responses and extracts the Retry-After
 * header for use in reconnection backoff.
 */
export class RateLimitAwareWebSocket extends WebSocket {
  /** Rate limit retry delay in ms, set when 429 is received */
  public rateLimitRetryAfterMs: number | null = null;

  constructor(address: string, protocols?: string | string[]) {
    super(address, protocols);

    this.on("unexpected-response", this.handleUnexpectedResponse.bind(this));
  }

  private handleUnexpectedResponse(
    _req: ClientRequest,
    res: IncomingMessage,
  ): void {
    if (res.statusCode === 429) {
      // Parse Retry-After header (can be seconds or HTTP date)
      const retryAfter = res.headers["retry-after"];
      let retryAfterMs = 30_000; // Default: 30 seconds

      if (retryAfter) {
        const seconds = parseInt(retryAfter as string, 10);
        if (!isNaN(seconds)) {
          retryAfterMs = seconds * 1000;
        } else {
          // Try parsing as HTTP date
          const date = Date.parse(retryAfter as string);
          if (!isNaN(date)) {
            retryAfterMs = Math.max(0, date - Date.now());
          }
        }
      }

      console.log(
        `[thenvoi] WebSocket 429 rate limited. Retry-After: ${retryAfterMs}ms`,
      );
      this.rateLimitRetryAfterMs = retryAfterMs;
    }
  }
}
