/**
 * `mergeText3` — the line-level diff3 behind concurrent-edit auto-merge.
 * Clean merges only; any true conflict returns null (the caller falls back
 * to conflict copies — a wrong silent merge is the one unforgivable output).
 */

import { describe, expect, it } from 'vitest';
import { MAX_LINES, mergeText3 } from '../src/index.js';

describe('mergeText3', () => {
  const base = 'alpha\nbravo\ncharlie\ndelta\necho\n';

  it('merges edits in different regions cleanly', () => {
    const ours = 'ALPHA\nbravo\ncharlie\ndelta\necho\n'; // first line
    const theirs = 'alpha\nbravo\ncharlie\ndelta\nECHO\n'; // last line
    expect(mergeText3(base, ours, theirs)).toBe('ALPHA\nbravo\ncharlie\ndelta\nECHO\n');
  });

  it('merges an insertion and a deletion separated by an anchor line', () => {
    const ours = 'alpha\nbravo\ncharlie\nINSERTED\ndelta\necho\n';
    const theirs = 'alpha\ncharlie\ndelta\necho\n'; // bravo deleted
    expect(mergeText3(base, ours, theirs)).toBe('alpha\ncharlie\nINSERTED\ndelta\necho\n');
  });

  it('adjacent insertion+deletion with no anchor between them refuse to merge', () => {
    const ours = 'alpha\nbravo\nINSERTED\ncharlie\ndelta\necho\n';
    const theirs = 'alpha\ncharlie\ndelta\necho\n'; // bravo deleted, no line between
    expect(mergeText3(base, ours, theirs)).toBeNull();
  });

  it('identical edits on both sides merge to that edit', () => {
    const same = 'alpha\nbravo\nCHARLIE\ndelta\necho\n';
    expect(mergeText3(base, same, same)).toBe(same);
  });

  it('appends and prepends merge (trailing additions on one side)', () => {
    const ours = 'alpha\nbravo\ncharlie\ndelta\necho\nappended-by-us\n';
    const theirs = 'preamble-by-them\nalpha\nbravo\ncharlie\ndelta\necho\n';
    expect(mergeText3(base, ours, theirs)).toBe(
      'preamble-by-them\nalpha\nbravo\ncharlie\ndelta\necho\nappended-by-us\n',
    );
  });

  it('conflicting edits to the SAME line refuse to merge', () => {
    const ours = 'alpha\nOURS\ncharlie\ndelta\necho\n';
    const theirs = 'alpha\nTHEIRS\ncharlie\ndelta\necho\n';
    expect(mergeText3(base, ours, theirs)).toBeNull();
  });

  it('different trailing additions on both sides refuse to merge', () => {
    const ours = 'alpha\nbravo\ncharlie\ndelta\necho\nours-tail\n';
    const theirs = 'alpha\nbravo\ncharlie\ndelta\necho\ntheirs-tail\n';
    expect(mergeText3(base, ours, theirs)).toBeNull();
  });

  it('an empty base with different contents refuses; equal ones merge', () => {
    expect(mergeText3('', 'a\n', 'b\n')).toBeNull();
    expect(mergeText3('', 'a\n', 'a\n')).toBe('a\n');
  });

  it('one side unchanged returns the other side verbatim', () => {
    const theirs = 'alpha\nbravo\ncharlie\ndelta\necho\nmore\nlines\n';
    expect(mergeText3(base, base, theirs)).toBe(theirs);
    expect(mergeText3(base, theirs, base)).toBe(theirs);
  });

  it('refuses oversized inputs instead of spiking memory', () => {
    const big = `${'line\n'.repeat(MAX_LINES)}`;
    const over = `${'line\n'.repeat(MAX_LINES + 1)}`;
    expect(mergeText3(big, over, big)).toBeNull();
  });
});
