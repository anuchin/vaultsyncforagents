import { describe, expect, it } from 'vitest';

import { conflictCopyPath, sanitizeDeviceName } from '../src/index.js';

/** 2026-08-20T14:23:45Z — chosen so UTC differs from any plausible local tz drift. */
const T_14_23_45 = Date.UTC(2026, 7, 20, 14, 23, 45);
/** Same minute boundary exercised across a day rollover: 2026-08-21T00:05Z. */
const T_NEXT_DAY = Date.UTC(2026, 7, 21, 0, 5, 0);

describe('conflictCopyPath — shape', () => {
  it('produces the documented name: stem (conflict UTC-date HH-mm - from device).ext', () => {
    expect(conflictCopyPath('/Note.md', 'Phone', T_14_23_45)).toBe(
      '/Note (conflict 2026-08-20 14-23 - from Phone).md',
    );
  });

  it('minutes only — seconds never appear', () => {
    expect(conflictCopyPath('/Note.md', 'Phone', T_14_23_45)).toContain('14-23');
    expect(conflictCopyPath('/Note.md', 'Phone', T_14_23_45)).not.toContain('14-23-45');
  });

  it('uses UTC even across day boundaries', () => {
    expect(conflictCopyPath('/Note.md', 'Phone', T_NEXT_DAY)).toBe(
      '/Note (conflict 2026-08-21 00-05 - from Phone).md',
    );
  });

  it('preserves the directory and works at the vault root', () => {
    expect(conflictCopyPath('/notes/deep/idea.md', 'MacBook', T_14_23_45)).toBe(
      '/notes/deep/idea (conflict 2026-08-20 14-23 - from MacBook).md',
    );
    expect(conflictCopyPath('idea.md', 'MacBook', T_14_23_45)).toBe(
      '/idea (conflict 2026-08-20 14-23 - from MacBook).md',
    );
  });

  it('preserves extensions — multi-dot keeps the last, dotfiles have none', () => {
    expect(conflictCopyPath('/a/note.final.md', 'P', T_14_23_45)).toBe(
      '/a/note.final (conflict 2026-08-20 14-23 - from P).md',
    );
    expect(conflictCopyPath('/.gitignore', 'P', T_14_23_45)).toBe(
      '/.gitignore (conflict 2026-08-20 14-23 - from P)',
    );
    expect(conflictCopyPath('/no-extension', 'P', T_14_23_45)).toBe(
      '/no-extension (conflict 2026-08-20 14-23 - from P)',
    );
  });
});

describe('conflictCopyPath — device name sanitization', () => {
  it('strips characters that are illegal on some filesystem', () => {
    expect(conflictCopyPath('/n.md', 'My "Cool" <Device?:*', T_14_23_45)).toBe(
      '/n (conflict 2026-08-20 14-23 - from My Cool Device).md',
    );
  });

  it('strips path separators hiding inside the device name', () => {
    expect(conflictCopyPath('/n.md', 'lap/top\\two', T_14_23_45)).toBe(
      '/n (conflict 2026-08-20 14-23 - from laptoptwo).md',
    );
  });

  it('strips control characters', () => {
    expect(conflictCopyPath('/n.md', 'ph\x00one\x1f\x7f', T_14_23_45)).toBe(
      '/n (conflict 2026-08-20 14-23 - from phone).md',
    );
  });

  it('trims, drops edge dots, and truncates to 30 code points without splitting pairs', () => {
    expect(conflictCopyPath('/n.md', '  Phone. ', T_14_23_45)).toBe(
      '/n (conflict 2026-08-20 14-23 - from Phone).md',
    );
    const forty = '0123456789012345678901234567890123456789';
    expect(sanitizeDeviceName(forty)).toBe(forty.slice(0, 30));
    // Emoji are surrogate pairs — truncation never splits one.
    const emojiName = '🙂'.repeat(40); // 40 code points, 80 UTF-16 units
    expect(sanitizeDeviceName(emojiName)).toBe('🙂'.repeat(30));
  });

  it('falls back when nothing survives sanitization', () => {
    expect(conflictCopyPath('/n.md', '***', T_14_23_45)).toBe(
      '/n (conflict 2026-08-20 14-23 - from unknown).md',
    );
    expect(conflictCopyPath('/n.md', '', T_14_23_45)).toBe(
      '/n (conflict 2026-08-20 14-23 - from unknown).md',
    );
  });
});

describe('conflictCopyPath — collisions', () => {
  it('defaults to no collision check', () => {
    expect(conflictCopyPath('/Note.md', 'Phone', T_14_23_45)).toBe(
      '/Note (conflict 2026-08-20 14-23 - from Phone).md',
    );
  });

  it('appends " 2", " 3", … before the extension while the path exists', () => {
    const taken = new Set<string>(['/Note (conflict 2026-08-20 14-23 - from Phone).md']);
    const exists = (p: string): boolean => taken.has(p);

    const second = conflictCopyPath('/Note.md', 'Phone', T_14_23_45, exists);
    expect(second).toBe('/Note (conflict 2026-08-20 14-23 - from Phone) 2.md');
    taken.add(second);

    expect(conflictCopyPath('/Note.md', 'Phone', T_14_23_45, exists)).toBe(
      '/Note (conflict 2026-08-20 14-23 - from Phone) 3.md',
    );
  });

  it('keeps the extension after the numeric suffix even without one', () => {
    const exists = (p: string): boolean => p === '/no-extension (conflict 2026-08-20 14-23 - from P)';
    expect(conflictCopyPath('/no-extension', 'P', T_14_23_45, exists)).toBe(
      '/no-extension (conflict 2026-08-20 14-23 - from P) 2',
    );
  });
});
