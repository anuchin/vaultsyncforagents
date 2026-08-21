import { describe, expect, it } from 'vitest';
import {
  formatSince,
  statusClassFor,
  statusLineFor,
  statusTooltipFor,
  StatusBarIndicator,
  type StatusItemLike,
} from '../src/statusbar.js';
import type { ConflictOp, SyncClientStatus } from '@vsa/core';

function status(partial: Partial<SyncClientStatus>): SyncClientStatus {
  return {
    state: 'live',
    lastSyncAt: null,
    pending: 0,
    conflicts: [],
    serverVersion: null,
    ...partial,
  };
}

const conflict = (path: string): ConflictOp =>
  ({ path, conflictCopyPath: `${path} (conflict)` }) as unknown as ConflictOp;

describe('formatSince', () => {
  it('formats seconds, minutes, hours (floored)', () => {
    expect(formatSince(0)).toBe('0s');
    expect(formatSince(999)).toBe('0s');
    expect(formatSince(12_000)).toBe('12s');
    expect(formatSince(59_999)).toBe('59s');
    expect(formatSince(60_000)).toBe('1m');
    expect(formatSince(3_600_000)).toBe('1h');
    expect(formatSince(3 * 3_600_000 + 1_200_000)).toBe('3h');
  });
});

describe('statusLineFor', () => {
  const now = 1_000_000;

  it('shows the syncing spinner while connecting/syncing', () => {
    expect(statusLineFor(status({ state: 'connecting' }), now)).toBe('vsa ⋯');
    expect(statusLineFor(status({ state: 'syncing' }), now)).toBe('vsa ⋯');
  });

  it('shows live with elapsed time since the last completed cycle', () => {
    expect(statusLineFor(status({ lastSyncAt: now - 12_000 }), now)).toBe('vsa ✓ 12s');
    expect(statusLineFor(status({ lastSyncAt: null }), now)).toBe('vsa ✓');
  });

  it('conflicts take over the line when present', () => {
    expect(
      statusLineFor(status({ conflicts: [conflict('/a.md'), conflict('/b.md')] }), now),
    ).toBe('vsa ⚠ conflicts: 2');
  });

  it('offline when disconnected; plain marker when idle', () => {
    expect(statusLineFor(status({ state: 'disconnected' }), now)).toBe('vsa ✗ offline');
    expect(statusLineFor(status({ state: 'idle' }), now)).toBe('vsa');
  });
});

describe('statusLineFor — indicator modes (the "Status bar indicator" setting)', () => {
  const now = 1_000_000;

  it('compact drops the trailing detail on every line', () => {
    expect(statusLineFor(status({ lastSyncAt: now - 12_000 }), now, 'compact')).toBe('vsa ✓');
    expect(statusLineFor(status({ state: 'disconnected' }), now, 'compact')).toBe('vsa ✗');
    expect(
      statusLineFor(status({ conflicts: [conflict('/a.md')] }), now, 'compact'),
    ).toBe('vsa ⚠');
    expect(statusLineFor(status({ state: 'connecting' }), now, 'compact')).toBe('vsa ⋯');
  });

  it('detailed is the default (and the explicit mode behaves the same)', () => {
    expect(statusLineFor(status({ lastSyncAt: now - 12_000 }), now)).toBe('vsa ✓ 12s');
    expect(statusLineFor(status({ lastSyncAt: now - 12_000 }), now, 'detailed')).toBe('vsa ✓ 12s');
  });

  it('paused wins over every state: "vsa ⏸" in both detail levels', () => {
    for (const mode of ['detailed', 'compact'] as const) {
      expect(statusLineFor(status({ state: 'live' }), now, mode, true)).toBe('vsa ⏸');
      expect(statusLineFor(status({ state: 'disconnected' }), now, mode, true)).toBe('vsa ⏸');
      expect(
        statusLineFor(status({ conflicts: [conflict('/a.md')] }), now, mode, true),
      ).toBe('vsa ⏸');
    }
  });
});

describe('statusTooltipFor — paused headline', () => {
  it('leads with "paused" when the context says so', () => {
    const tooltip = statusTooltipFor(
      status({ state: 'live' }),
      { url: 'https://w.example', deviceName: 'D', paused: true },
      1_000_000,
    );
    expect(tooltip).toContain('VaultSync for Agents — paused');
  });
});

describe('statusClassFor / tooltip', () => {
  it('maps states to modifier classes', () => {
    expect(statusClassFor(status({ state: 'disconnected' }))).toBe('vsa-error');
    expect(statusClassFor(status({ conflicts: [conflict('/a.md')] }))).toBe('vsa-warn');
    expect(statusClassFor(status({}))).toBe('');
  });

  it('tooltip carries the detail (state, worker, device, counters, note)', () => {
    const tooltip = statusTooltipFor(
      status({ lastSyncAt: 988_000, pending: 3, conflicts: [conflict('/a.md')] }),
      { url: 'https://w.example', deviceName: 'Pixel', note: 'token rejected' },
      1_000_000,
    );
    expect(tooltip).toContain('live');
    expect(tooltip).toContain('https://w.example');
    expect(tooltip).toContain('Pixel');
    expect(tooltip).toContain('12s ago');
    expect(tooltip).toContain('Pending changes: 3');
    expect(tooltip).toContain('Conflicts: 1');
    expect(tooltip).toContain('/a.md');
    expect(tooltip).toContain('token rejected');
  });
});

describe('StatusBarIndicator', () => {
  it('paints text, classes, and the title tooltip', () => {
    const item: StatusItemLike & { classes: Set<string>; attributes: Record<string, string> } = {
      textContent: '',
      classes: new Set(),
      attributes: {},
      addClass(cls) {
        this.classes.add(cls);
      },
      removeClass(cls) {
        this.classes.delete(cls);
      },
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
    };
    const indicator = new StatusBarIndicator(item);
    indicator.update(status({ state: 'syncing' }), { url: 'https://w.example', deviceName: 'D' }, 1);
    expect(item.textContent).toBe('vsa ⋯');
    expect(item.attributes['title']).toContain('syncing');
    // The base class (styles.css) is always present; modifiers come and go.
    expect(item.classes.has('vsa-status')).toBe(true);

    indicator.update(
      status({ conflicts: [conflict('/a.md')] }),
      { url: 'https://w.example', deviceName: 'D' },
      1,
    );
    expect(item.textContent).toBe('vsa ⚠ conflicts: 1');
    expect(item.classes.has('vsa-warn')).toBe(true);

    indicator.update(status({ state: 'disconnected' }), { url: '', deviceName: '' }, 1);
    expect(item.textContent).toBe('vsa ✗ offline');
    expect(item.classes.has('vsa-warn')).toBe(false);
    expect(item.classes.has('vsa-error')).toBe(true);
  });

  it('honors the context mode and paused flag (the settings dropdown / pause button)', () => {
    const item: StatusItemLike & { classes: Set<string>; attributes: Record<string, string> } = {
      textContent: '',
      classes: new Set(),
      attributes: {},
      addClass(cls) {
        this.classes.add(cls);
      },
      removeClass(cls) {
        this.classes.delete(cls);
      },
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
    };
    const indicator = new StatusBarIndicator(item);

    // Compact via the context (what the plugin passes after applyStatusBarMode).
    indicator.update(
      status({ lastSyncAt: 988_000 }),
      { url: 'https://w.example', deviceName: 'D', mode: 'compact' },
      1_000_000,
    );
    expect(item.textContent).toBe('vsa ✓');

    // Paused: the pause glyph, "paused" tooltip headline — state is secondary.
    indicator.update(
      status({ state: 'live' }),
      { url: 'https://w.example', deviceName: 'D', paused: true },
      1_000_000,
    );
    expect(item.textContent).toBe('vsa ⏸');
    expect(item.attributes['title']).toContain('paused');
  });
});
