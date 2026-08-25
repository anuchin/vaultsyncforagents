/**
 * Line-level three-way text merge (the concurrent-edit auto-merge, §4's
 * conflict-copy policy made cheaper for the common case).
 *
 * Given the common ancestor (`base`), the local edit (`ours`), and the
 * remote head (`theirs`), produce the merged text when every changed region
 * was touched by at most ONE side — the classic diff3 "clean merge". Any
 * region both sides changed differently, or inputs too large to diff
 * safely, returns `null` and the caller falls back to conflict copies
 * (never a wrong silent merge).
 *
 * Line granularity, `\n`-separated, CRLF tolerated (a `\r` before the
 * newline is part of the line's content and merges as such). Bounded: each
 * input may hold at most `MAX_LINES` lines and base×ours + base×theirs DP
 * cells at most `MAX_CELLS` — beyond that, merging is refused rather than
 * risking a memory spike inside a sync cycle.
 */

/** Per-input line cap (≈ a 5,000-line note is already an outlier). */
export const MAX_LINES = 5000;
/** Total DP cell budget across both diffs. */
export const MAX_CELLS = 2_000_000;

/**
 * Merge three texts. Returns the merged text when the merge is clean, or
 * `null` when it is not (conflicting region, oversized input).
 */
export function mergeText3(base: string, ours: string, theirs: string): string | null {
  const baseLines = splitLines(base);
  const oursLines = splitLines(ours);
  const theirsLines = splitLines(theirs);
  if (
    baseLines.length > MAX_LINES ||
    oursLines.length > MAX_LINES ||
    theirsLines.length > MAX_LINES ||
    baseLines.length * (oursLines.length + 1) +
      baseLines.length * (theirsLines.length + 1) >
      MAX_CELLS
  ) {
    return null;
  }

  const oursPairs = lcsPairs(baseLines, oursLines);
  const theirsPairs = lcsPairs(baseLines, theirsLines);
  // Stable per base line: matched on BOTH sides ⇒ an anchor.
  const stableOurs = new Uint8Array(baseLines.length);
  const stableTheirs = new Uint8Array(baseLines.length);
  const oursAt = new Int32Array(baseLines.length).fill(-1); // base idx → ours idx (matched)
  const theirsAt = new Int32Array(baseLines.length).fill(-1);
  for (const [b, o] of oursPairs) {
    stableOurs[b] = 1;
    oursAt[b] = o;
  }
  for (const [b, t] of theirsPairs) {
    stableTheirs[b] = 1;
    theirsAt[b] = t;
  }

  const out: string[] = [];
  // Mutual anchors: base lines matched on BOTH sides. The gaps between
  // consecutive anchors (including before the first and after the last) are
  // the three-way regions; each side's slice for a gap is bounded by its
  // matched positions at the surrounding anchors.
  const anchors: number[] = [];
  for (let i = 0; i < baseLines.length; i++) {
    if (stableOurs[i] === 1 && stableTheirs[i] === 1) anchors.push(i);
  }

  let prevBase = -1;
  let prevOurs = 0;
  let prevTheirs = 0;
  const resolveGap = (baseEnd: number, oursEnd: number, theirsEnd: number): boolean => {
    const baseRegion = baseLines.slice(prevBase + 1, baseEnd);
    const oursRegion = oursLines.slice(prevOurs, oursEnd);
    const theirsRegion = theirsLines.slice(prevTheirs, theirsEnd);
    const oursChanged = !regionsEqual(oursRegion, baseRegion);
    const theirsChanged = !regionsEqual(theirsRegion, baseRegion);
    if (oursChanged && theirsChanged) {
      if (!regionsEqual(oursRegion, theirsRegion)) return false; // genuine conflict
      out.push(...oursRegion); // both made the same change
    } else if (oursChanged) {
      out.push(...oursRegion);
    } else if (theirsChanged) {
      out.push(...theirsRegion);
    } else {
      out.push(...baseRegion);
    }
    return true;
  };

  for (const anchor of anchors) {
    if (!resolveGap(anchor, oursAt[anchor]!, theirsAt[anchor]!)) return null;
    out.push(baseLines[anchor]!);
    prevBase = anchor;
    prevOurs = oursAt[anchor]! + 1;
    prevTheirs = theirsAt[anchor]! + 1;
  }
  // The tail after the last anchor: both sides may append.
  if (!resolveGap(baseLines.length, oursLines.length, theirsLines.length)) return null;
  return out.join('\n');
}

/** Split keeping no separators (rejoined with '\n'); a trailing newline vanishes. */
function splitLines(text: string): string[] {
  if (text === '') return [];
  return text.split('\n');
}

function regionsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * LCS matched-index pairs between `a` (base) and `b` (side), both increasing.
 * Classic DP; sizes are pre-bounded by the caller's caps.
 */
function lcsPairs(a: readonly string[], b: readonly string[]): Array<[number, number]> {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = new Uint16Array(rows * cols); // line counts ≤ MAX_LINES < 65535
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * cols + j] =
        a[i] === b[j]
          ? (table[(i + 1) * cols + (j + 1)] ?? 0) + 1
          : Math.max(table[(i + 1) * cols + j] ?? 0, table[i * cols + (j + 1)] ?? 0);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if ((table[(i + 1) * cols + j] ?? 0) >= (table[i * cols + (j + 1)] ?? 0)) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return pairs;
}
