/**
 * Conflict-copy file naming (ARCHITECTURE.md §4, FR-6).
 *
 * When a device loses a conflict but its content must be preserved, the
 * content is committed to a sibling "conflict copy" path shaped like:
 *
 *     Note (conflict 2026-08-20 14-23 - from Phone).md
 *     └─ stem ─┘└────── UTC date + HH-mm ──────┘└ device ┘└ext┘
 *
 * Rules:
 *   - timestamp is always UTC (never a local timezone) so every client
 *     computes the identical name from the same commit time;
 *   - the device name is sanitized for filesystem safety (see
 *     `sanitizeDeviceName`);
 *   - the original extension is preserved (last dot in the basename, as long
 *     as it is not the first character — `.gitignore` has no extension);
 *   - if the candidate already exists (in the local index or the remote
 *     manifest — the caller supplies the `exists` predicate), ` 2`, ` 3`, …
 *     is appended before the extension.
 */

import { basename, normalizeVaultPath, parentPath } from './paths.js';

/** Characters forbidden on at least one supported platform. */
const ILLEGAL_FILENAME_CHARS = /[<>:"/\\|?*]/g;
/** C0 controls + DEL — never valid in filenames. */
const CONTROL_CHARS = /[\x00-\x1f\x7f]/g;

/** Max length (in code points) of a sanitized device name. */
const MAX_DEVICE_NAME_LENGTH = 30;

/** Fallback when a device name sanitizes to nothing. */
const FALLBACK_DEVICE_NAME = 'unknown';

/** Highest ` N` suffix tried before giving up. */
const MAX_COLLISION_SUFFIX = 999;

/**
 * Sanitize a device name for use inside a filename: strip `<>:"/\\|?*` and
 * control characters, trim whitespace and edge dots (Windows segments may
 * not end with `.` or whitespace), truncate to 30 code points (never splits
 * a surrogate pair). Returns `'unknown'` when nothing survives.
 */
export function sanitizeDeviceName(name: string): string {
  let cleaned = name.replace(ILLEGAL_FILENAME_CHARS, '').replace(CONTROL_CHARS, '');
  cleaned = [...cleaned].slice(0, MAX_DEVICE_NAME_LENGTH).join('');
  cleaned = cleaned.trim().replace(/^[.\s]+|[.\s]+$/g, '');
  return cleaned.length === 0 ? FALLBACK_DEVICE_NAME : cleaned;
}

/**
 * Compute the conflict-copy path for `path`.
 *
 * Pure and deterministic: the same `(path, deviceName, now, exists)` always
 * yields the same result. `now` is the conflict's epoch-ms timestamp (the
 * caller passes it in — no hidden clocks); `exists` is consulted for
 * collision avoidance and typically checks the local index plus the remote
 * manifest.
 *
 * Throws when more than `MAX_COLLISION_SUFFIX` name collisions occur (a
 * genuinely pathological vault state the caller should surface, not paper
 * over).
 */
export function conflictCopyPath(
  path: string,
  deviceName: string,
  now: number,
  exists: (candidatePath: string) => boolean = () => false,
): string {
  const normalized = normalizeVaultPath(path);
  const dir = parentPath(normalized);
  const name = basename(normalized);

  const lastDot = name.lastIndexOf('.');
  const hasExtension = lastDot > 0; // a leading dot marks a dotfile, not an extension
  const stem = hasExtension ? name.slice(0, lastDot) : name;
  const extension = hasExtension ? name.slice(lastDot) : '';

  const suffix = ` (conflict ${formatConflictStamp(now)} - from ${sanitizeDeviceName(deviceName)})`;
  const join = (fileName: string): string => (dir === '/' ? `/${fileName}` : `${dir}/${fileName}`);

  let candidate = join(`${stem}${suffix}${extension}`);
  for (let n = 2; n <= MAX_COLLISION_SUFFIX; n++) {
    if (!exists(candidate)) return candidate;
    candidate = join(`${stem}${suffix} ${n}${extension}`);
  }
  throw new Error(
    `conflictCopyPath: more than ${MAX_COLLISION_SUFFIX} collisions for ${JSON.stringify(normalized)}`,
  );
}

/** `2026-08-20 14-23` — UTC date, space, zero-padded HH-mm. Minutes, not seconds. */
function formatConflictStamp(now: number): string {
  const d = new Date(now);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    ` ${pad(d.getUTCHours())}-${pad(d.getUTCMinutes())}`
  );
}
