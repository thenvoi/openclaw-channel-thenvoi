/**
 * Type declarations for the phoenix package.
 */

declare module "phoenix" {
  export interface SocketOptions {
    params?: Record<string, unknown>;
    timeout?: number;
    heartbeatIntervalMs?: number;
    logger?: (kind: string, msg: string, data?: unknown) => void;
    encode?: (payload: unknown, callback: (encoded: string) => void) => void;
    decode?: (payload: string, callback: (decoded: unknown) => void) => void;
  }

  export interface Push {
    receive(
      status: "ok" | "error" | "timeout",
      callback: (response?: unknown) => void,
    ): Push;
  }

  export class Channel {
    constructor(topic: string, params?: Record<string, unknown>, socket?: Socket);

    join(timeout?: number): Push;
    leave(timeout?: number): Push;
    push(event: string, payload: unknown, timeout?: number): Push;
    on(event: string, callback: (payload: unknown) => void): number;
    off(event: string, ref?: number): void;

    readonly topic: string;
    readonly state: "closed" | "errored" | "joined" | "joining" | "leaving";
  }

  export class Socket {
    constructor(endPoint: string, opts?: SocketOptions);

    connect(): void;
    disconnect(callback?: () => void, code?: number, reason?: string): void;

    onOpen(callback: () => void): void;
    onClose(callback: () => void): void;
    onError(callback: (error: unknown) => void): void;
    onMessage(callback: (message: unknown) => void): void;

    channel(topic: string, chanParams?: Record<string, unknown>): Channel;

    readonly isConnected: boolean;
    readonly connectionState(): string;
  }
}
