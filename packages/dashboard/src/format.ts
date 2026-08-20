/**
 * Pure display formatters: relative time, human byte sizes, expiry
 * countdowns. Deterministic — every function takes `now` where relevant so
 * tests never depend on wall-clock timing.
 */

/** "just now" / "42s ago" / "5m ago" / "3h ago" / "2d ago" / date fallback. */
export function relativeTime(ts: number, now: number): string {
  const delta = now - ts;
  if (delta < 5000) return 'just now';
  const seconds = Math.floor(delta / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return absoluteTime(ts);
}

/** Local-ish "YYYY-MM-DD HH:MM" (stable across locales for tests). */
export function absoluteTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** "0 B" / "730 B" / "1.2 KB" / "45.8 MB" / "3.1 GB" / "1.0 TB" (1024-based). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  if (unit === 0) return `${Math.round(value)} B`;
  const text = value >= 100 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, '');
  return `${text} ${units[unit]}`;
}

/** Milliseconds until expiry as "mm:ss"; clamped at "expired" / "99:59+". */
export function countdownText(msRemaining: number): string {
  if (msRemaining <= 0) return 'expired';
  const totalSeconds = Math.floor(msRemaining / 1000);
  const clamped = Math.min(totalSeconds, 99 * 60 + 59);
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return totalSeconds > clamped ? '99:59+' : `${pad(minutes)}:${pad(seconds)}`;
}
