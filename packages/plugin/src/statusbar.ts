/**
 * Status-bar indicator (plugin scope item #5): a small passive view over
 * `SyncClientStatus`, repainted by the plugin's 1 s supervision tick.
 *
 *   vsa ⋯              connecting / syncing
 *   vsa ✓ 12s          live, last completed cycle 12 s ago
 *   vsa ⚠ conflicts: 2 conflicts observed (conflict copies exist in the vault)
 *   vsa ✗ offline      disconnected (reconnect backoff running)
 *
 * The tooltip carries the detail: state, worker URL, device, last sync, pending.
 */

import type { SyncClientStatus } from '@vsa/core';

/** The slice of HTMLElement the indicator touches (tests pass a plain object). */
export interface StatusItemLike {
  textContent: string;
  addClass?(cls: string): unknown;
  removeClass?(cls: string): unknown;
  setAttribute?(name: string, value: string): unknown;
}

export interface StatusContext {
  url: string;
  deviceName: string;
  /** Extra line (e.g. an auth failure note) appended to the tooltip. */
  note?: string;
}

/** `now - since`, floored: `12s`, `5m`, `3h` — display only. */
export function formatSince(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

/** The one-line status text for a client status at time `now`. */
export function statusLineFor(status: SyncClientStatus, now: number): string {
  switch (status.state) {
    case 'connecting':
    case 'syncing':
      return 'vsa ⋯';
    case 'disconnected':
      return 'vsa ✗ offline';
    case 'live':
      if (status.conflicts.length > 0) return `vsa ⚠ conflicts: ${status.conflicts.length}`;
      if (status.lastSyncAt === null) return 'vsa ✓';
      return `vsa ✓ ${formatSince(now - status.lastSyncAt)}`;
    case 'idle':
      return 'vsa';
  }
}

/** Tooltip lines (joined with `\n`). */
export function statusTooltipFor(status: SyncClientStatus, context: StatusContext, now: number): string {
  const stateLabel: Record<SyncClientStatus['state'], string> = {
    idle: 'not running',
    connecting: 'connecting…',
    syncing: 'syncing…',
    live: 'live',
    disconnected: 'offline — reconnecting',
  };
  const lines = [`VaultSync for Agents — ${stateLabel[status.state]}`];
  if (context.url !== '') lines.push(`Worker: ${context.url}`);
  if (context.deviceName !== '') lines.push(`Device: ${context.deviceName}`);
  lines.push(
    status.lastSyncAt === null
      ? 'Last sync: never'
      : `Last sync: ${formatSince(now - status.lastSyncAt)} ago`,
  );
  lines.push(`Pending changes: ${status.pending}`);
  lines.push(`Conflicts: ${status.conflicts.length}`);
  if (status.conflicts.length > 0) {
    lines.push(`Conflict copies: ${status.conflicts.map((c) => c.path).join(', ')}`);
  }
  if (context.note !== undefined && context.note !== '') lines.push(context.note);
  return lines.join('\n');
}

/** CSS modifier for the indicator (tinted warning/error states). */
export function statusClassFor(status: SyncClientStatus): string {
  if (status.state === 'disconnected') return 'vsa-error';
  if (status.conflicts.length > 0) return 'vsa-warn';
  return '';
}

/**
 * Paints one status-bar item. Passive: the plugin calls `update()` from its
 * supervision tick — no timers of its own to leak.
 */
export class StatusBarIndicator {
  /** Always on — the base class styles.css targets. */
  private static readonly BASE_CLASS = 'vsa-status';
  private static readonly MODIFIER_CLASSES = ['vsa-warn', 'vsa-error'];

  constructor(private readonly item: StatusItemLike) {}

  update(status: SyncClientStatus, context: StatusContext, now: number): void {
    this.item.textContent = statusLineFor(status, now);
    this.item.addClass?.(StatusBarIndicator.BASE_CLASS);
    const modifier = statusClassFor(status);
    for (const cls of StatusBarIndicator.MODIFIER_CLASSES) {
      if (cls === modifier) this.item.addClass?.(cls);
      else this.item.removeClass?.(cls);
    }
    this.item.setAttribute?.('title', statusTooltipFor(status, context, now));
  }
}
