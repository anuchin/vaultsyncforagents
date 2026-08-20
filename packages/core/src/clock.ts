/**
 * Logical clock operations (ARCHITECTURE.md §4).
 *
 * Clocks are per-file monotonic counters owned by the sync authority (the
 * Durable Object). A clock pairs the counter with the id of the device that
 * produced it. Ordering is fully deterministic on every client:
 *
 *   1. higher `counter` wins;
 *   2. exact counter tie → lexicographically greater `deviceId` wins
 *      (plain JS string comparison, i.e. by UTF-16 code units);
 *   3. identical counter *and* identical deviceId → the clocks are equal.
 *
 * Wall-clock time never participates in ordering (display-only per §4).
 */

import type { LogicalClock } from './types.js';

/** Result of `compareClocks`: sign of `a` vs `b` (positive ⇒ `a` wins). */
export type ClockComparison = -1 | 0 | 1;

/**
 * Compare two logical clocks.
 *
 * Returns `1` when `a` wins, `-1` when `b` wins, `0` when the clocks are
 * identical (same counter *and* same deviceId — in practice only when
 * comparing a clock with itself). Callers that must pick a side on `0`
 * should do so explicitly and document the choice.
 */
export function compareClocks(a: LogicalClock, b: LogicalClock): ClockComparison {
  if (a.counter !== b.counter) return a.counter > b.counter ? 1 : -1;
  if (a.deviceId !== b.deviceId) return a.deviceId > b.deviceId ? 1 : -1;
  return 0;
}

/**
 * The clock a commit from `deviceId` would receive when building on `parent`
 * (or on nothing, when `parent` is absent): parent's counter + 1.
 *
 * This is the *tentative* clock used by client-side conflict prediction
 * (`resolve.ts`): the DO assigns real counters with the same rule, so the
 * prediction matches the server's arbitration as long as both sides build on
 * the same parent.
 */
export function nextClock(
  parent: LogicalClock | null | undefined,
  deviceId: string,
): LogicalClock {
  return { counter: (parent?.counter ?? 0) + 1, deviceId };
}
