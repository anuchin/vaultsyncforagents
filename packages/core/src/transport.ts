/**
 * The transport seam (ARCHITECTURE.md §5, §8).
 *
 * `SyncClient` speaks exclusively to this interface; the real WebSocket
 * implementation (plugin/daemon/CLI) and the in-memory test double
 * (`MessageBus`) are interchangeable behind it. No Node APIs — the same
 * interface serves Workers tests and Obsidian mobile.
 */

import { NetworkError } from './errors.js';
import type { Message } from './protocol.js';

/** Why a transport closed. `code` mirrors WebSocket close codes when known. */
export interface CloseReason {
  code?: number;
  reason?: string;
}

/**
 * A bidirectional message channel to the sync authority. Callbacks are
 * setter-style: the last registration wins (one consumer per transport, as
 * with a wrapped WebSocket). All methods are non-blocking; `send` hands the
 * message to the platform and never awaits delivery.
 */
export interface Transport {
  send(message: Message): void;
  onMessage(callback: (message: Message) => void): void;
  onClose(callback: (reason: CloseReason) => void): void;
  close(): void;
}

/**
 * Schedules one delivery. The default is synchronous (call `deliver`
 * immediately); tests inject a queuing scheduler to simulate latency,
 * reordering, or manual flush control — never real timers.
 */
export type DeliveryScheduler = (deliver: () => void) => void;

const synchronousDelivery: DeliveryScheduler = (deliver) => deliver();

export interface MessageBusOptions {
  /**
   * Artificial delivery behavior. Default: deliver synchronously inside
   * `send` (fully deterministic, zero timers). Inject a queuing scheduler to
   * emulate latency and flush it manually in tests.
   */
  scheduleDelivery?: DeliveryScheduler;
}

/**
 * An in-memory `Transport` endpoint. Endpoints mean nothing alone: call
 * `MessageBus.connectPair()` to obtain a linked `(client, server)` pair.
 *
 * Semantics:
 *  - messages are cloned through JSON on `send`, exactly like a real wire —
 *    receivers can never mutate sender state and vice versa;
 *  - closing either side fires `onClose` on both;
 *  - `send` after close throws `NetworkError`;
 *  - `send` when the peer has closed closes this side instead of delivering
 *    (a full send buffer into a dead socket, approximated).
 */
export class MemoryTransport implements Transport {
  /** Set by `MessageBus.connectPair`. */
  peer?: MemoryTransport;

  private messageCallback?: (message: Message) => void;
  private closeCallbacks: Array<(reason: CloseReason) => void> = [];
  private open = true;

  constructor(private readonly schedule: DeliveryScheduler = synchronousDelivery) {}

  send(message: Message): void {
    if (!this.open) {
      throw new NetworkError('send on a closed transport');
    }
    const peer = this.peer;
    if (peer === undefined || !peer.open) {
      this.close({ code: 1006, reason: 'peer closed' });
      return;
    }
    const payload = cloneMessage(message);
    this.schedule(() => {
      if (peer.open && peer.messageCallback !== undefined) {
        peer.messageCallback(payload);
      }
    });
  }

  onMessage(callback: (message: Message) => void): void {
    this.messageCallback = callback;
  }

  onClose(callback: (reason: CloseReason) => void): void {
    this.closeCallbacks.push(callback);
  }

  close(reason: CloseReason = { code: 1000, reason: 'closed by caller' }): void {
    if (!this.open) return;
    this.open = false;
    // The closing side learns first, then the peer.
    for (const callback of this.closeCallbacks) callback(reason);
    const peer = this.peer;
    if (peer !== undefined && peer.open) {
      peer.open = false;
      for (const callback of peer.closeCallbacks) callback(reason);
    }
  }

  /** Whether this endpoint is still open (test assertions). */
  get isOpen(): boolean {
    return this.open;
  }
}

/**
 * A deterministic in-memory network for tests: `connectPair()` links a fresh
 * client endpoint with a fresh server endpoint; deliveries flow through the
 * injected scheduler (synchronous by default).
 */
export class MessageBus {
  private readonly scheduleDelivery: DeliveryScheduler;

  constructor(options: MessageBusOptions = {}) {
    this.scheduleDelivery = options.scheduleDelivery ?? synchronousDelivery;
  }

  connectPair(): { client: MemoryTransport; server: MemoryTransport } {
    const client = new MemoryTransport(this.scheduleDelivery);
    const server = new MemoryTransport(this.scheduleDelivery);
    client.peer = server;
    server.peer = client;
    return { client, server };
  }
}

/** Deep-clone a protocol message the way a JSON wire would. */
function cloneMessage(message: Message): Message {
  return JSON.parse(JSON.stringify(message)) as Message;
}
