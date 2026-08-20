/**
 * Reconnect policy (plugin scope item #5): exponential backoff with jitter,
 * capped at 60 s. The plugin's 1 s supervision tick asks the supervisor what
 * to do whenever the client reports `disconnected`; a scheduled reconnect is
 * a single flight — never a stack of retries.
 */

import type { SyncClientState } from '@vsa/core';

export interface BackoffOptions {
  /** First attempt delay (default 1 s). */
  baseMs?: number;
  /** Ceiling (default 60 s per the plugin spec). */
  capMs?: number;
  /** Jitter fraction around the exponential value, 0–0.5 (default 0.3). */
  jitter?: number;
  /** Injectable randomness (tests). Default `Math.random`. */
  random?: () => number;
}

export const DEFAULT_RECONNECT_BASE_MS = 1000;
export const DEFAULT_RECONNECT_CAP_MS = 60_000;

/**
 * Delay for attempt N (0-based): `min(cap, base · 2^attempt)` with symmetric
 * multiplicative jitter, floored at 250 ms.
 */
export function backoffDelayMs(attempt: number, options: BackoffOptions = {}): number {
  const base = options.baseMs ?? DEFAULT_RECONNECT_BASE_MS;
  const cap = options.capMs ?? DEFAULT_RECONNECT_CAP_MS;
  const jitter = options.jitter ?? 0.3;
  const random = options.random ?? Math.random;
  const exponential = Math.min(cap, base * 2 ** attempt);
  const factor = 1 + (random() * 2 - 1) * jitter;
  return Math.round(Math.min(cap, Math.max(250, exponential * factor)));
}

export type ReconnectDecision = { action: 'reconnect'; delayMs: number } | { action: 'wait' };

/**
 * Tracks reconnect attempts across the supervision tick. Non-disconnected
 * states reset the backoff ladder (a successful cycle means the network is
 * back); `scheduled` keeps exactly one reconnect in flight.
 */
export class ReconnectSupervisor {
  private attempt = 0;
  private scheduled = false;
  private readonly options: BackoffOptions;

  constructor(options: BackoffOptions = {}) {
    this.options = options;
  }

  /** Call each tick; on `reconnect`, follow up with `acknowledged()`. */
  consider(state: SyncClientState): ReconnectDecision {
    if (state !== 'disconnected') {
      this.attempt = 0;
      this.scheduled = false;
      return { action: 'wait' };
    }
    if (this.scheduled) return { action: 'wait' };
    return { action: 'reconnect', delayMs: backoffDelayMs(this.attempt, this.options) };
  }

  /** Mark the returned reconnect as in flight (one at a time). */
  acknowledged(): void {
    this.attempt += 1;
    this.scheduled = true;
  }

  /** The in-flight reconnect settled (success or failure). */
  settled(): void {
    this.scheduled = false;
  }

  /** Completed reconnect attempts since the last healthy state. */
  get attempts(): number {
    return this.attempt;
  }
}
