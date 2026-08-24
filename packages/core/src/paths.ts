/**
 * Vault path utilities.
 *
 * Vault-internal paths are POSIX-normalized strings relative to the vault root,
 * in CANONICAL Unicode form:
 *   - always start with `/` (`/a/b.md`); the vault root itself is `/`
 *   - segments separated by `/`; no trailing slash, no `.`/`..` segments,
 *     no duplicate slashes
 *   - never escape the root: any `..` that would pop above `/` is rejected
 *   - every segment is NFC-normalized (Unicode canonical composition), so
 *     canonically-equal names (macOS's NFD vs everyone's NFC) fold to ONE
 *     path everywhere in the system — see `foldKeyForPath`
 *
 * Backslashes are converted to `/` (Windows callers routinely hand us
 * `dir\file.md`), but absolute Windows paths (drive letters like `C:/`, UNC
 * `\\server\share`) are rejected — a vault path is never absolute in the host
 * filesystem sense.
 */

/** A vault-internal, POSIX-normalized path string (e.g. `/notes/todo.md`). */
export type VaultPath = string;

/** Thrown when a path cannot be interpreted as a vault-internal path. */
export class InvalidVaultPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidVaultPathError';
  }
}

/**
 * Normalize a user- or platform-supplied path into canonical vault form.
 *
 * Accepted: `a/b.md` (root-relative without leading slash), `/a/b.md`,
 * `a\b.md` (backslash conversion), `a/./b.md`, `a/b/../c.md` (interior `..`
 * resolves), duplicate slashes, trailing slashes.
 *
 * Rejected: `..` escaping the root (`/../a`, `/a/../..`), absolute Windows
 * drive paths (`C:/vault/a.md`, `C:\vault\a.md`), UNC paths (`\\srv\share`),
 * leading `//`, NUL bytes, and Windows-unsafe segments — reserved device
 * names (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`, any
 * extension, any case) and segments ending in `.` or ` `.
 *
 * Accepted input in any Unicode normalization form comes out NFC (segments
 * only — the `/` separators are ASCII). NFC is the canonical form because it
 * is what NFC-habitual platforms (Windows, Linux input paths, the web) keep
 * by default, and what the server enforces (`isNFCPath`).
 */
export function normalizeVaultPath(input: string): VaultPath {
  if (typeof input !== 'string') {
    throw new InvalidVaultPathError(`Vault path must be a string, got ${typeof input}`);
  }
  if (input.includes('\0')) {
    throw new InvalidVaultPathError(`Vault path contains NUL byte: ${JSON.stringify(input)}`);
  }
  if (/^[a-zA-Z]:/.test(input)) {
    throw new InvalidVaultPathError(
      `Vault path must not be an absolute host path (drive letter): ${JSON.stringify(input)}`,
    );
  }
  if (input.startsWith('\\\\')) {
    throw new InvalidVaultPathError(
      `Vault path must not be a UNC path: ${JSON.stringify(input)}`,
    );
  }

  const converted = input.replace(/\\/g, '/');
  if (converted.startsWith('//')) {
    throw new InvalidVaultPathError(
      `Vault path must not start with "//" (UNC or protocol-style path): ${JSON.stringify(input)}`,
    );
  }

  const segments: string[] = [];
  for (const segment of converted.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) {
        throw new InvalidVaultPathError(
          `Vault path escapes the vault root: ${JSON.stringify(input)}`,
        );
      }
      segments.pop();
      continue;
    }
    if (isWindowsUnsafeSegment(segment)) {
      throw new InvalidVaultPathError(
        `Vault path segment is a Windows-reserved device name or ends with a dot/space: ${JSON.stringify(segment)}`,
      );
    }
    segments.push(segment.normalize('NFC'));
  }
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

/**
 * Join a base vault path with one or more relative path parts.
 *
 * Each part must be relative (no leading `/` after backslash conversion) and
 * is appended to the base before normalization; `..` inside parts may not
 * escape the resulting root.
 */
export function joinPath(base: string, ...parts: readonly string[]): VaultPath {
  let combined = normalizeVaultPath(base);
  for (const part of parts) {
    const converted = part.replace(/\\/g, '/');
    if (converted.startsWith('/')) {
      throw new InvalidVaultPathError(
        `joinPath parts must be relative, got ${JSON.stringify(part)}`,
      );
    }
    combined = `${combined === '/' ? '' : combined}/${converted}`;
  }
  return normalizeVaultPath(combined);
}

/**
 * Parent directory of a vault path. The parent of `/` is `/` (the root has no
 * parent above it); walk `while (p !== parentPath(p))` style loops terminate.
 */
export function parentPath(path: string): VaultPath {
  const normalized = normalizeVaultPath(path);
  if (normalized === '/') return '/';
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash === 0 ? '/' : normalized.slice(0, lastSlash);
}

/**
 * Final path segment. `basename('/a/b.md')` → `b.md`; `basename('/')` → `''`.
 */
export function basename(path: string): VaultPath {
  const normalized = normalizeVaultPath(path);
  if (normalized === '/') return '';
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

/**
 * Whether `child` names something at least one level BELOW `ancestor`
 * (both normalized vault paths). The root is an ancestor of everything
 * except itself; a path is never strictly beneath itself.
 */
export function isStrictlyBeneath(child: string, ancestor: string): boolean {
  if (ancestor === '/') return child !== '/';
  return child.length > ancestor.length && child.startsWith(`${ancestor}/`);
}

// --- Windows-unsafe names ------------------------------------------------------

/** Reserved DOS device base names (matched case-insensitively, any extension). */
const WINDOWS_RESERVED_BASE_NAMES: ReadonlySet<string> = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

/**
 * Whether one path segment can never be materialized on Windows: a reserved
 * device base name — the segment up to its first dot, case-insensitive, so
 * `CON`, `nul.txt` and `COM3.tar.gz` all match — or a trailing dot/space,
 * which Windows strips when creating the file (the on-disk name would
 * silently differ from the synced one).
 */
function isWindowsUnsafeSegment(segment: string): boolean {
  // `.`/`..` are normalization tokens, never real segment names; they are
  // resolved (or rejected) by `normalizeVaultPath` itself.
  if (segment === '.' || segment === '..') return false;
  if (segment.endsWith('.') || segment.endsWith(' ')) return true;
  const dot = segment.indexOf('.');
  const base = (dot === -1 ? segment : segment.slice(0, dot)).toLowerCase();
  return WINDOWS_RESERVED_BASE_NAMES.has(base);
}

/**
 * Whether any segment of a vault path is Windows-unsafe (see
 * `isWindowsUnsafeSegment`). Such paths are rejected by `normalizeVaultPath`
 * and must never be pushed or pulled: a Windows client cannot materialize
 * them, so attempting the write would fail every sync cycle.
 */
export function isWindowsUnsafePath(path: string): boolean {
  return path.split('/').some((segment) => isWindowsUnsafeSegment(segment));
}

// --- Canonical-form and fold keys (protocol path safety, §14) -----------------

/**
 * Whether every segment of `path` is already in NFC canonical form — the
 * server's admission rule for NEW paths. Clients normalize at their scan
 * seam (`scanVault`) so they never emit non-NFC paths; the check is the
 * defense that keeps a non-conforming client from forking canonically-equal
 * names (`Café.md` NFC vs `Cafe\u0301.md` NFD) into two vault files.
 *
 * NFC alone does NOT make two names unique on disk the way a fold does —
 * it is the composition canonical form; pair it with `foldKeyForPath` for
 * collision checks.
 */
export function isNFCPath(path: string): boolean {
  return path.normalize('NFC') === path;
}

/**
 * The fold key two paths share when they cannot safely coexist in one vault:
 * NFC canonical form, case-folded. Two live entries MUST NEVER share a key —
 * on case-insensitive filesystems (Windows, macOS) only one of the pair is
 * visible at a time, and on every platform canonically-equal-but-byte-
 * distinct names (NFC vs NFD) are the same name to a human. The server
 * rejects the second commit that would share a key (`PATH_COLLIDES`), and
 * clients pre-suppress such pushes (never pushed, surfaced as diagnostics —
 * same UX contract as the case-collision guard, which this widens from
 * case-only to case + canonical form).
 *
 * The fold is deliberately pragmatic — `String.prototype.toLowerCase()`
 * (locale-independent Unicode default case mapping), exactly what the
 * pre-existing client guard used. Full UAX#21 case folding (ß→ss, final
 * sigma) would need a pinned table; default lowercasing covers the entire
 * realistic collision space for vault filenames.
 */
export function foldKeyForPath(path: string): string {
  return path.normalize('NFC').toLowerCase();
}
