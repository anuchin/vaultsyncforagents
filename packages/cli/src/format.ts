/**
 * Human-readable formatting for `vsa` output: relative times, byte sizes,
 * local timestamps. Pure functions — trivially unit-testable and shared by
 * every command.
 */

/** "3s ago", "5m ago", "2h ago", "4d ago", or an absolute local timestamp. */
export function relativeTime(epochMs: number, now: number = Date.now()): string {
  const delta = now - epochMs;
  if (delta < 0) return formatDate(epochMs); // future timestamps: clock skew
  const seconds = Math.floor(delta / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(epochMs);
}

/** `never` for sentinel times (0 / negative), else local `YYYY-MM-DD HH:mm:ss`. */
export function formatDate(epochMs: number): string {
  if (!Number.isFinite(epochMs) || epochMs <= 0) return 'never';
  const date = new Date(epochMs);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/** "1.2 KB", "4.3 MB", … (SI units, one decimal below 1 GB). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const decimals = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[unit]}`;
}

/** Clock skew verdict for doctor: warn above 60 s (protocol decision input). */
export const CLOCK_SKEW_WARN_MS = 60_000;

export function skewVerdict(localMs: number, serverMs: number | null): {
  skewMs: number | null;
  warn: boolean;
} {
  if (serverMs === null || !Number.isFinite(serverMs)) {
    return { skewMs: null, warn: false };
  }
  const skew = localMs - serverMs;
  return { skewMs: skew, warn: Math.abs(skew) > CLOCK_SKEW_WARN_MS };
}

/** Compact relative device presence for tables. */
export function presence(lastSeenMs: number, online: boolean, now: number = Date.now()): string {
  if (lastSeenMs <= 0) return 'never';
  return online ? `online (${relativeTime(lastSeenMs, now)})` : relativeTime(lastSeenMs, now);
}
