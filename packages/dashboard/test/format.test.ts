/**
 * Formatter tests — relative time, human bytes, expiry countdowns
 * (deterministic: `now` is always injected).
 */
import { describe, expect, it } from 'vitest';
import { countdownText, formatBytes, relativeTime } from '../src/format.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('relativeTime', () => {
  const now = Date.UTC(2026, 7, 20, 12, 0, 0);

  it('handles fresh and slightly-future stamps as "just now"', () => {
    expect(relativeTime(now, now)).toBe('just now');
    expect(relativeTime(now + 2_000, now)).toBe('just now');
  });

  it('covers the s/m/h/d ladders', () => {
    expect(relativeTime(now - 30_000, now)).toBe('30s ago');
    expect(relativeTime(now - 5 * MIN, now)).toBe('5m ago');
    expect(relativeTime(now - 3 * HOUR, now)).toBe('3h ago');
    expect(relativeTime(now - 2 * DAY, now)).toBe('2d ago');
  });

  it('falls back to an absolute date beyond a week', () => {
    expect(relativeTime(now - 8 * DAY, now)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('never renders "0s ago" or negative units', () => {
    expect(relativeTime(now - 4_900, now)).toBe('just now');
    expect(relativeTime(now - 59_000, now)).toBe('59s ago');
  });
});

describe('formatBytes', () => {
  it('renders small sizes in bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1)).toBe('1 B');
    expect(formatBytes(730)).toBe('730 B');
  });

  it('scales with one decimal, dropping trailing .0', () => {
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(45 * 1024 * 1024)).toBe('45 MB');
    expect(formatBytes(3.14 * 1024 * 1024 * 1024)).toBe('3.1 GB');
  });

  it('rounds instead of growing digits above 100', () => {
    expect(formatBytes(123 * 1024)).toBe('123 KB');
    expect(formatBytes(999.6 * 1024)).toBe('1000 KB');
  });

  it('tolerates junk input', () => {
    expect(formatBytes(Number.NaN)).toBe('0 B');
    expect(formatBytes(-5)).toBe('0 B');
  });
});

describe('countdownText', () => {
  it('formats mm:ss', () => {
    expect(countdownText(10 * 60_000)).toBe('10:00');
    expect(countdownText(9 * 60_000 + 53_000)).toBe('09:53');
    expect(countdownText(61_000)).toBe('01:01');
  });

  it('expires at zero and clamps absurd values', () => {
    expect(countdownText(0)).toBe('expired');
    expect(countdownText(-1)).toBe('expired');
    expect(countdownText(7 * 24 * 60 * 60_000)).toBe('99:59+');
  });
});
