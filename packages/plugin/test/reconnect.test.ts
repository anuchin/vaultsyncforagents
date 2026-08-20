import { describe, expect, it } from 'vitest';
import { backoffDelayMs, ReconnectSupervisor } from '../src/reconnect.js';

const midpoint = () => 0.5; // no jitter offset

describe('backoffDelayMs', () => {
  it('doubles exponentially from the base', () => {
    expect(backoffDelayMs(0, { random: midpoint })).toBe(1000);
    expect(backoffDelayMs(1, { random: midpoint })).toBe(2000);
    expect(backoffDelayMs(2, { random: midpoint })).toBe(4000);
    expect(backoffDelayMs(5, { random: midpoint })).toBe(32_000);
  });

  it('caps at 60 seconds', () => {
    expect(backoffDelayMs(10, { random: midpoint })).toBe(60_000);
    expect(backoffDelayMs(100, { random: midpoint })).toBe(60_000);
  });

  it('applies symmetric jitter bounded by the exponential value', () => {
    expect(backoffDelayMs(2, { random: () => 0 })).toBe(2800); // -30%
    expect(backoffDelayMs(2, { random: () => 1 })).toBe(5200); // +30%
    // Jitter can never push past the cap or below the 250 ms floor.
    expect(backoffDelayMs(20, { random: () => 1 })).toBe(60_000);
    expect(backoffDelayMs(0, { random: () => 0, baseMs: 100 })).toBe(250);
  });
});

describe('ReconnectSupervisor', () => {
  it('recommends a reconnect only while disconnected, with growing delays', () => {
    const supervisor = new ReconnectSupervisor({ random: midpoint });
    expect(supervisor.consider('live')).toEqual({ action: 'wait' });
    expect(supervisor.consider('syncing')).toEqual({ action: 'wait' });

    expect(supervisor.consider('disconnected')).toEqual({ action: 'reconnect', delayMs: 1000 });
    supervisor.acknowledged();
    // One in flight: no second reconnect while the first is pending.
    expect(supervisor.consider('disconnected')).toEqual({ action: 'wait' });

    supervisor.settled();
    expect(supervisor.consider('disconnected')).toEqual({ action: 'reconnect', delayMs: 2000 });
    supervisor.acknowledged();
    supervisor.settled();
    expect(supervisor.consider('disconnected')).toEqual({ action: 'reconnect', delayMs: 4000 });
  });

  it('resets the ladder as soon as the client is healthy again', () => {
    const supervisor = new ReconnectSupervisor({ random: midpoint });
    supervisor.consider('disconnected');
    supervisor.acknowledged();
    supervisor.settled();
    supervisor.consider('disconnected');
    supervisor.acknowledged();
    supervisor.settled();
    expect(supervisor.attempts).toBe(2);

    supervisor.consider('live'); // healthy → reset
    expect(supervisor.attempts).toBe(0);
    expect(supervisor.consider('disconnected')).toEqual({ action: 'reconnect', delayMs: 1000 });
  });
});
