import { describe, expect, it } from 'vitest';

import { compareClocks, nextClock } from '../src/index.js';

describe('compareClocks', () => {
  it('higher counter wins regardless of device ids', () => {
    expect(compareClocks({ counter: 2, deviceId: 'aaa' }, { counter: 1, deviceId: 'zzz' })).toBe(1);
    expect(compareClocks({ counter: 1, deviceId: 'zzz' }, { counter: 2, deviceId: 'aaa' })).toBe(-1);
    expect(compareClocks({ counter: 10, deviceId: 'b' }, { counter: 9, deviceId: 'a' })).toBe(1);
  });

  it('exact counter tie → lexicographically greater deviceId wins', () => {
    expect(compareClocks({ counter: 5, deviceId: 'device-b' }, { counter: 5, deviceId: 'device-a' })).toBe(1);
    expect(compareClocks({ counter: 5, deviceId: 'device-a' }, { counter: 5, deviceId: 'device-b' })).toBe(-1);
    // Plain UTF-16 code-unit ordering, documented for cross-client determinism.
    expect(compareClocks({ counter: 0, deviceId: 'Z' }, { counter: 0, deviceId: 'a' })).toBe(-1);
  });

  it('identical counter and deviceId compare equal', () => {
    expect(compareClocks({ counter: 3, deviceId: 'dev' }, { counter: 3, deviceId: 'dev' })).toBe(0);
  });

  it('is antisymmetric (sign flips when arguments swap)', () => {
    const a = { counter: 7, deviceId: 'x-1' };
    const b = { counter: 7, deviceId: 'x-2' };
    expect(compareClocks(a, b)).toBe(-compareClocks(b, a));
  });
});

describe('nextClock', () => {
  it('increments the parent counter and stamps the committing device', () => {
    expect(nextClock({ counter: 4, deviceId: 'other' }, 'me')).toEqual({
      counter: 5,
      deviceId: 'me',
    });
  });

  it('starts at 1 without a parent', () => {
    expect(nextClock(null, 'me')).toEqual({ counter: 1, deviceId: 'me' });
    expect(nextClock(undefined, 'me')).toEqual({ counter: 1, deviceId: 'me' });
  });

  it('does not mutate the parent clock', () => {
    const parent = { counter: 2, deviceId: 'other' };
    nextClock(parent, 'me');
    expect(parent).toEqual({ counter: 2, deviceId: 'other' });
  });
});
