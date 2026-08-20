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
 * `workspace-mobile.json`, and `.obsidian/cache/`.
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

  return false;
}
