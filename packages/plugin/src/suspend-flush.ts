/**
 * Mobile suspend flush (v1's mobile-lifecycle lesson): when the OS hides or
 * suspends the app, run one final sync cycle BEFORE the process can die.
 *
 * Why: the plugin's queued work (a debounced cycle, an in-flight push) lives
 * in memory, and Obsidian has already persisted the edit to the vault file —
 * so suspend kills nothing, but it DELAYS the push until the next app-open.
 * That widens the conflict window (another device editing the same note in
 * the meantime) from ~30 s of scheduler latency to potentially hours. On
 * `visibilitychange → hidden` and `pagehide` (iOS's strongest pre-kill
 * signal) we trigger an immediate cycle; the OS grants a few seconds of
 * grace, which a small vault's cycle fits comfortably. Best-effort by
 * construction — a cycle that does not finish simply resumes on next open,
 * exactly as without the flush.
 */

/** The document surface needed (structural — tests pass a plain object). */
export interface DocumentLike {
  visibilityState: string;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface SuspendFlushOptions {
  /** Runs one immediate sync cycle; must never throw (fire-and-forget). */
  flush: () => void;
  /** Override for tests; default hooks both events. */
  document?: DocumentLike;
}

/**
 * Install the suspend listeners; returns the uninstaller. Idempotent per
 * call site: keep the returned uninstaller and call it before re-installing
 * (a sync-session restart re-wires the current client).
 */
export function installSuspendFlush(options: SuspendFlushOptions): () => void {
  const doc = options.document ?? (globalThis as { document?: DocumentLike }).document;
  if (doc === undefined) return () => {}; // no DOM (tests, exotic hosts) — nothing to hook
  const onVisibility = (): void => {
    if (doc.visibilityState === 'hidden') options.flush();
  };
  const onPageHide = (): void => options.flush();
  doc.addEventListener('visibilitychange', onVisibility);
  doc.addEventListener('pagehide', onPageHide);
  return () => {
    doc.removeEventListener('visibilitychange', onVisibility);
    doc.removeEventListener('pagehide', onPageHide);
  };
}
