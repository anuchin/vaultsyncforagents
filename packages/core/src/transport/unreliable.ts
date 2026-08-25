/**
 * Fault-injection transport (v1's `UnreliableNetwork`, rebuilt on the
 * `Transport` seam): wraps any transport and applies scripted network
 * faults to CLIENT→SERVER frames — drop, duplicate, delay, reorder,
 * disconnect — plus client "crash points" via {@link CrashPoint}.
 *
 * The server→client direction stays reliable: faults on the server's
 * replies would exercise the SERVER's protocol handling, which the worker
 * suite already covers against hostile frames (`protocol-errors.test.ts`);
 * this harness is for the CLIENT's at-least-once behavior — idempotent
 * replays, expectation re-matching, reconnect convergence.
 *
 * Deterministic by construction: a seeded PRNG (mulberry32) decides every
 * coin flip, and `drain()` advances time manually — no real timers. The
 * harness never breaks invariants the real wire guarantees loosely
 * (ordering is only ever shuffled across the delay window), so what passes
 * here is what the protocol actually promises.
 */

import { NetworkError } from '../errors.js';
import type { Message } from '../protocol.js';
import type { Transport } from '../transport.js';

/** The faults a rule set can apply to an outgoing frame. */
export type FaultKind = 'drop' | 'duplicate' | 'delay' | 'reorder';

/** A scripted fault plan: per-kind probabilities, plus delay bounds. */
export interface FaultPlan {
  /** Probability [0,1] of silently discarding a frame. */
  drop?: number;
  /** Probability [0,1] of delivering a frame twice. */
  duplicate?: number;
  /** Probability [0,1] of holding a frame until `drain()` (or a later frame
   *  passes it — bounded reorder, never unbounded). */
  delay?: number;
  /** Mean delay in ms applied to NON-held frames (jitter = ±50%); time is
   *  virtual — `drain(untilMs)` releases frames whose due time passed. */
  latencyMs?: number;
  /** Probability [0,1] of closing the transport after delivering a frame. */
  disconnect?: number;
}

/** Seeded PRNG (mulberry32) — deterministic fault coin flips. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface HeldFrame {
  dueAt: number;
  deliver: () => void;
}

/**
 * Wrap `inner` with scripted faults. `virtualNow` starts at 0 and advances
 * only through {@link UnreliableTransport.drain} — the test owns time.
 */
export class UnreliableTransport implements Transport {
  private messageCallback?: (message: Message) => void;
  private closeCallback?: (reason: { code?: number; reason?: string }) => void;
  private readonly held: HeldFrame[] = [];
  private virtualNow = 0;
  private readonly random: () => number;
  private readonly plan: FaultPlan;
  private readonly inner: Transport;

  constructor(inner: Transport, plan: FaultPlan = {}, seed = 1) {
    this.inner = inner;
    this.plan = plan;
    this.random = seededRandom(seed);
    inner.onMessage((message) => this.messageCallback?.(message));
    inner.onClose((reason) => this.closeCallback?.(reason));
  }

  send(message: Message): void {
    const roll = this.random();
    let p = 0;
    const chance = (key: keyof FaultPlan): number => {
      p += (this.plan[key] as number | undefined) ?? 0;
      return p;
    };
    // One roll picks the FIRST matching fault (drop > duplicate > delay >
    // reorder baseline): mutually exclusive per frame keeps accounting sane.
    if (roll < chance('drop')) {
      // A frame lost in transit kills the connection — conservative real-
      // world proxy behavior (TCP itself never silently drops). Pending
      // client expectations are rejected by the close, which is exactly the
      // recovery path a real socket death takes.
      this.inner.close();
      this.closeCallback?.({ code: 1006, reason: 'frame dropped in transit' });
      return;
    }
    const deliveries: number = roll < chance('duplicate') ? 2 : 1;
    const willHold = roll < chance('delay');
    const base = this.plan.latencyMs ?? 0;
    const latency = base === 0 ? 0 : Math.max(0, base * (0.5 + this.random()));

    for (let i = 0; i < deliveries; i++) {
      const deliver = (): void => this.inner.send(message);
      if (willHold) {
        this.held.push({ dueAt: this.virtualNow, deliver }); // released by the next drain()
        continue;
      }
      if (latency > 0) {
        this.held.push({ dueAt: this.virtualNow + latency, deliver });
        continue;
      }
      deliver();
    }
    if (this.random() < ((this.plan.disconnect as number) ?? 0)) {
      this.inner.close();
      this.closeCallback?.({ code: 1006, reason: 'faulted' });
    }
  }

  onMessage(callback: (message: Message) => void): void {
    this.messageCallback = callback;
  }

  onClose(callback: (reason: { code?: number; reason?: string }) => void): void {
    this.closeCallback = callback;
  }

  close(): void {
    this.releaseAll();
    this.inner.close();
  }

  /** Release held frames whose due time is within `untilMs` (pinned frames always). */
  drain(untilMs = Number.MAX_SAFE_INTEGER): void {
    this.virtualNow = Math.max(this.virtualNow, untilMs);
    while (this.held.length > 0) {
      const ready = this.held.filter((frame) => frame.dueAt <= this.virtualNow);
      if (ready.length === 0) break;
      for (const frame of ready) {
        // Reorder within the released batch: a deterministic shuffle pick.
        const index = Math.floor(this.random() * this.held.length) % this.held.length;
        const pick = this.held.splice(index, 1)[0] ?? frame;
        pick.deliver();
      }
    }
  }

  /** Number of frames still held (asserting the harness itself in tests). */
  get heldCount(): number {
    return this.held.length;
  }

  private releaseAll(): void {
    for (const frame of this.held.splice(0)) frame.deliver();
  }
}

/**
 * Client crash points (v1's crash hooks): `beforeSend` fires around every
 * client→server frame, and a hooked callback can THROW to simulate the
 * process dying between "edit made" and "frame on the wire". Used by
 * simulation tests to prove state written before a crash converges after
 * restart.
 */
export type CrashPoint = 'before-send' | 'after-send';

export function crashAt(
  point: CrashPoint,
  trigger: (message: Message) => boolean,
): { wrap(transport: Transport): Transport; crashed: Message[] } {
  const crashed: Message[] = [];
  return {
    crashed,
    wrap(transport: Transport): Transport {
      let messageCallback: (message: Message) => void = () => {};
      let closeCallback: (reason: { code?: number; reason?: string }) => void = () => {};
      transport.onMessage((m) => messageCallback(m));
      transport.onClose((r) => closeCallback(r));
      return {
        send(message: Message): void {
          if (point === 'before-send' && trigger(message)) {
            crashed.push(message);
            throw new NetworkError('client crashed before send');
          }
          transport.send(message);
          if (point === 'after-send' && trigger(message)) {
            crashed.push(message);
            throw new NetworkError('client crashed after send');
          }
        },
        onMessage(cb) {
          messageCallback = cb;
        },
        onClose(cb) {
          closeCallback = cb;
        },
        close() {
          transport.close();
        },
      };
    },
  };
}
