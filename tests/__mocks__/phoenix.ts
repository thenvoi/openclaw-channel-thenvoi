/**
 * Mock implementation of Phoenix Socket and Channel for testing.
 */

type EventCallback = (payload: unknown) => void;

// Global configuration for all new Socket instances
let globalConnectShouldFail = false;
let globalConnectError: unknown = undefined;

/**
 * Set global connect behavior for all new Socket instances.
 * Useful for testing reconnection logic where new sockets are created.
 */
export function setGlobalConnectBehavior(shouldFail: boolean, error?: unknown): void {
  globalConnectShouldFail = shouldFail;
  globalConnectError = error;
}

/**
 * Reset global connect behavior to default (success).
 */
export function resetGlobalConnectBehavior(): void {
  globalConnectShouldFail = false;
  globalConnectError = undefined;
}

interface MockPush {
  receive: (status: string, callback: (response?: unknown) => void) => MockPush;
}

export class Channel {
  readonly topic: string;
  private callbacks: Map<string, EventCallback[]> = new Map();
  private joinStatus: "ok" | "error" | "timeout" = "ok";
  private joinError?: string;
  private joined = false;

  constructor(topic: string, _params?: Record<string, unknown>) {
    this.topic = topic;
  }

  /**
   * Configure join behavior for testing.
   */
  setJoinBehavior(status: "ok" | "error" | "timeout", error?: string): void {
    this.joinStatus = status;
    this.joinError = error;
  }

  on(event: string, callback: EventCallback): void {
    const existing = this.callbacks.get(event) ?? [];
    existing.push(callback);
    this.callbacks.set(event, existing);
  }

  off(event: string): void {
    this.callbacks.delete(event);
  }

  /**
   * Simulate server pushing an event.
   */
  simulateEvent(event: string, payload: unknown): void {
    const handlers = this.callbacks.get(event) ?? [];
    handlers.forEach((handler) => handler(payload));
  }

  join(): MockPush {
    const push: MockPush = {
      receive: (status: string, callback: (response?: unknown) => void) => {
        // Defer execution to simulate async behavior
        setTimeout(() => {
          if (status === this.joinStatus) {
            if (status === "error") {
              callback(this.joinError);
            } else if (status === "ok") {
              this.joined = true;
              callback();
            } else {
              callback();
            }
          }
        }, 0);
        return push;
      },
    };
    return push;
  }

  leave(): void {
    this.joined = false;
    this.callbacks.clear();
  }

  isJoined(): boolean {
    return this.joined;
  }
}

export class Socket {
  private connected = false;
  private channels: Map<string, Channel> = new Map();
  private onOpenCallback?: () => void;
  private onErrorCallback?: (error: unknown) => void;
  private onCloseCallback?: () => void;
  private shouldFailConnect = false;
  private connectError?: unknown;

  constructor(
    _endPoint: string,
    _opts?: { params?: Record<string, unknown> },
  ) {
    // Apply global settings to new instances
    this.shouldFailConnect = globalConnectShouldFail;
    this.connectError = globalConnectError;
  }

  /**
   * Configure connection behavior for testing.
   */
  setConnectBehavior(shouldFail: boolean, error?: unknown): void {
    this.shouldFailConnect = shouldFail;
    this.connectError = error;
  }

  onOpen(callback: () => void): void {
    this.onOpenCallback = callback;
  }

  onError(callback: (error: unknown) => void): void {
    this.onErrorCallback = callback;
  }

  onClose(callback: () => void): void {
    this.onCloseCallback = callback;
  }

  connect(): void {
    setTimeout(() => {
      if (this.shouldFailConnect) {
        this.onErrorCallback?.(
          this.connectError ?? new Error("Connection failed"),
        );
      } else {
        this.connected = true;
        this.onOpenCallback?.();
      }
    }, 0);
  }

  disconnect(): void {
    this.connected = false;
    this.channels.forEach((channel) => channel.leave());
    this.channels.clear();
    this.onCloseCallback?.();
  }

  channel(topic: string, params?: Record<string, unknown>): Channel {
    const channel = new Channel(topic, params);
    this.channels.set(topic, channel);
    return channel;
  }

  /**
   * Get a channel by topic for testing.
   */
  getChannel(topic: string): Channel | undefined {
    return this.channels.get(topic);
  }

  /**
   * Simulate socket close for testing.
   */
  simulateClose(): void {
    this.connected = false;
    this.onCloseCallback?.();
  }

  /**
   * Simulate socket error for testing.
   */
  simulateError(error: unknown): void {
    this.onErrorCallback?.(error);
  }

  isConnected(): boolean {
    return this.connected;
  }
}
