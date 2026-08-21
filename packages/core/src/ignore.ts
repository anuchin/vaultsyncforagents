/**
 * Vault ignore rules (ARCHITECTURE.md §4, FR-11/FR-42) — shared by every
 * client so local scans, watchers, and commit paths agree byte-for-byte.
 *
 * Matching is segment-based and case-insensitive (the owner's primary
 * platforms — Windows, macOS — have case-insensitive filesystems, so
 * `.Trash/foo.md` must not sneak past the `.trash/` rule).
 */

import { normalizeVaultPath } from './paths.js';

/** Settings subset `isIgnored` needs; `VaultSettings` satisfies it. */
export interface IgnoreSettings {
  obsidianSync: boolean;
  /**
   * User-defined extra ignore patterns (client-side only). Glob-lite syntax:
   * `*` matches within one path segment, a whole `**` segment spans any
   * number of segments, matching is case-insensitive. A pattern containing
   * `/` is anchored at the vault root (`private/**`); a bare pattern without
   * `/` matches a file NAME at any depth (`*.tmp`). Empty lines are ignored.
   */
  extraIgnores?: readonly string[];
}

/** Ignored wherever they appear, as any path segment (dir or file name). */
const ALWAYS_IGNORED_SEGMENTS: ReadonlySet<string> = new Set([
  '.trash', // local delete-recovery dir (FR-42)
  '.ds_store',
  '.vaultsyncforagents', // client state dir (local index) inside the vault
  'thumbs.db',
]);

/** `.obsidian/` files excluded even when `.obsidian/` sync is opted in. */
const OBSIDIAN_VOLATILE_FILES: ReadonlySet<string> = new Set([
  '.obsidian/workspace.json',
  '.obsidian/workspace-mobile.json',
]);

/**
 * Whether `vaultPath` must be excluded from sync.
 *
 * Always ignored: `.trash/`, `.DS_Store`, `Thumbs.db`, `.vaultsyncforagents/`
 * (any depth). `.obsidian/` is ignored entirely when `settings.obsidianSync`
 * is false; when true, everything under it syncs except `workspace.json`,
 * `workspace-mobile.json`, and `.obsidian/cache/`. Finally, every pattern in
 * `settings.extraIgnores` is matched (glob-lite — see `IgnoreSettings`).
 */
export function isIgnored(vaultPath: string, settings: IgnoreSettings): boolean {
  const normalized = normalizeVaultPath(vaultPath);
  if (normalized === '/') return false;

  const lower = normalized.slice(1).toLowerCase();
  const segments = lower.split('/');

  if (segments.some((segment) => ALWAYS_IGNORED_SEGMENTS.has(segment))) {
    return true;
  }

  if (segments[0] === '.obsidian') {
    if (!settings.obsidianSync) return true;
    if (OBSIDIAN_VOLATILE_FILES.has(lower)) return true;
    if (segments[1] === 'cache') return true; // the dir itself and anything under it
  }

  const extras = settings.extraIgnores;
  if (extras !== undefined && extras.length > 0) {
    for (const pattern of extras) {
      const compiled = compileExtraIgnore(pattern);
      if (compiled !== null && matchesSegments(compiled, segments)) return true;
    }
  }

  return false;
}

// --- extra ignore patterns (glob-lite) ---------------------------------------------

/** A compiled extra-ignore pattern: lowercased, `/`-split segments. */
type CompiledPattern = { segments: readonly string[]; anchored: boolean };

/**
 * Normalize one user pattern into matchable segments. Returns `null` for
 * blank patterns (they can never match — and must not become "ignore
 * everything" by accident). A leading/trailing `/` is tolerated and stripped;
 * `anchored` records whether the pattern names a path (matched from the
 * vault root) or a bare name (matched against any suffix of the path).
 */
function compileExtraIgnore(pattern: string): CompiledPattern | null {
  let cleaned = pattern.trim().toLowerCase();
  while (cleaned.startsWith('/')) cleaned = cleaned.slice(1);
  while (cleaned.endsWith('/')) cleaned = cleaned.slice(0, -1);
  if (cleaned === '') return null;
  return { segments: cleaned.split('/'), anchored: cleaned.includes('/') };
}

/** Pattern vs path segments; `anchored` patterns may also start deeper. */
function matchesSegments(pattern: CompiledPattern, path: readonly string[]): boolean {
  if (pattern.anchored) {
    return segmentsMatch(pattern.segments, path);
  }
  // Bare name pattern: match any trailing segment run (`*.tmp` at any depth).
  for (let start = 0; start < path.length; start++) {
    if (segmentsMatch(pattern.segments, path.slice(start))) return true;
  }
  return false;
}

/** Glob-lite segment matching: `*` inside a segment, `**` as a whole segment. */
function segmentsMatch(pattern: readonly string[], path: readonly string[]): boolean {
  if (pattern.length === 0) return path.length === 0;
  const head = pattern[0];
  const rest = pattern.slice(1);
  if (head === undefined) return path.length === 0;
  if (head === '**') {
    // `**` consumes zero or more path segments.
    for (let skip = 0; skip <= path.length; skip++) {
      if (segmentsMatch(rest, path.slice(skip))) return true;
    }
    return false;
  }
  if (path.length === 0 || !segmentMatch(head, path[0]!)) return false;
  return segmentsMatch(rest, path.slice(1));
}

/** One segment: literal text with `*` wildcards (any run within the segment). */
function segmentMatch(pattern: string, segment: string): boolean {
  if (!pattern.includes('*')) return pattern === segment;
  const first = pattern.indexOf('*');
  const last = pattern.lastIndexOf('*');
  if (!segment.startsWith(pattern.slice(0, first))) return false;
  if (!segment.endsWith(pattern.slice(last + 1))) return false;
  let index = first;
  for (const middle of pattern.slice(first, last + 1).split('*').slice(1, -1)) {
    const found = segment.indexOf(middle, index);
    if (found === -1) return false;
    index = found + middle.length;
  }
  return true;
}
