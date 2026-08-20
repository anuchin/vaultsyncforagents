/**
 * Status view (FR-31) — engine health, devices (online/offline + last-seen,
 * revoke), last synced edit, attachments, storage, recent events feed.
 * Auto-refreshes every 15 s; network failures raise the offline banner but
 * keep the last rendered data; 401/421 collapse to login/claim.
 */

import { api, ApiError } from '../api.js';
import { badge, clear, field, h, primaryButton, quietButton } from '../dom.js';
import { formatBytes, relativeTime } from '../format.js';
import { pairingPanel } from '../pairpanel.js';
import { deviceCounts, deviceNameMap, deviceRows, eventRows, healthBadge } from '../rows.js';
import type { DeviceRowModel, EventRowModel } from '../rows.js';
import type { StatusDoc } from '../types.js';
import { DEVICE_TYPES } from '../types.js';
import type { ViewContext, ViewHandle } from '../view.js';

const REFRESH_MS = 15_000;

export function statusView(ctx: ViewContext): ViewHandle {
  let doc: StatusDoc | null = null;
  let panel: { dispose(): void } | null = null;
  let overlay: HTMLElement | null = null;
  let disposed = false;

  // --- static skeleton -----------------------------------------------------------------

  const vaultTitle = h('span', { class: 'vault-name', text: '…' });
  const health = h('span');
  const freshness = h('span', { class: 'freshness', text: 'auto-refreshes every 15 s' });

  const statLastEdit = h('div', { class: 'stat-value', text: '—' });
  const statLastEditSub = h('div', { class: 'stat-sub', text: 'no edits synced yet' });
  const statDevices = h('div', { class: 'stat-value', text: '—' });
  const statDevicesSub = h('div', { class: 'stat-sub', text: '' });
  const statAttachments = h('div', { class: 'stat-value', text: '—' });
  const statAttachmentsSub = h('div', { class: 'stat-sub', text: '' });
  const statStorage = h('div', { class: 'stat-value', text: '—' });
  const statStorageSub = h('div', { class: 'stat-sub', text: '' });

  const deviceError = h('p', { class: 'form-error', role: 'alert' });
  const deviceBody = h('tbody');
  const eventList = h('ul', { class: 'event-list' }, h('li', { class: 'event-empty', text: 'Loading…' }));

  const root = h(
    'div',
    { class: 'page' },
    h(
      'header',
      { class: 'page-header' },
      h(
        'div',
        { class: 'page-title' },
        vaultTitle,
        health,
        freshness,
      ),
      h(
        'nav',
        { class: 'page-nav' },
        quietButton('Dashboard', () => ctx.dispatch({ type: 'navigate', view: 'status' }), { 'data-active': true }),
        quietButton('Restore', () => ctx.dispatch({ type: 'navigate', view: 'restore' })),
        quietButton('Sign out', () => ctx.dispatch({ type: 'logged-out' })),
      ),
    ),
    h(
      'div',
      { class: 'stats-grid' },
      statCard('Last synced edit', statLastEdit, statLastEditSub),
      statCard('Devices', statDevices, statDevicesSub),
      statCard('Attachments', statAttachments, statAttachmentsSub),
      statCard('Storage used', statStorage, statStorageSub),
    ),
    h(
      'section',
      { class: 'card' },
      h(
        'div',
        { class: 'card-head' },
        h('h2', { text: 'Devices' }),
        primaryButton('Pair a device', openPairModal),
      ),
      deviceError,
      h(
        'table',
        { class: 'table' },
        h(
          'thead',
          undefined,
          h('tr', undefined, h('th', { text: 'Name' }), h('th', { text: 'Type' }), h('th', { text: 'Status' }), h('th', { text: 'Last seen' }), h('th', { text: '' })),
        ),
        deviceBody,
      ),
    ),
    h(
      'section',
      { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', { text: 'Recent events' })),
      eventList,
    ),
  );

  // --- data ------------------------------------------------------------------------------

  async function load(): Promise<void> {
    try {
      doc = await api.status();
      ctx.dispatch({ type: 'network-ok' });
      if (!disposed) render();
    } catch (error) {
      if (disposed) return;
      handleApiError(error, 'Could not refresh status');
    }
  }

  function handleApiError(error: unknown, fallback: string): void {
    if (error instanceof ApiError) {
      if (error.kind === 'unauthorized') {
        ctx.dispatch({ type: 'unauthorized' });
        return;
      }
      if (error.kind === 'unclaimed') {
        ctx.dispatch({ type: 'unclaimed' });
        return;
      }
      if (error.kind === 'network') {
        ctx.dispatch({ type: 'network-error' });
        return;
      }
      deviceError.textContent = error.message;
    } else {
      deviceError.textContent = fallback;
    }
  }

  function render(): void {
    const current = doc;
    if (current === null) return;
    const now = Date.now();

    vaultTitle.textContent = current.vaultName === '' ? 'Vault' : current.vaultName;
    const badgeModel = healthBadge(current);
    clear(health);
    health.append(badge(badgeModel.label, badgeModel.tone));

    // Stats.
    if (current.lastEdit === null) {
      statLastEdit.textContent = '—';
      statLastEditSub.textContent = 'no edits synced yet';
    } else {
      const name = current.devices.find((d) => d.id === current.lastEdit?.deviceId)?.name ?? 'unknown device';
      statLastEdit.textContent = relativeTime(current.lastEdit.ts, now);
      statLastEditSub.textContent = `${name} — ${current.lastEdit.path}`;
    }

    const counts = deviceCounts(current.devices);
    statDevices.textContent = String(counts.online);
    statDevicesSub.textContent = `online of ${counts.total} paired (${counts.offline} offline)`;
    statAttachments.textContent = String(current.attachments.count);
    statAttachmentsSub.textContent = formatBytes(current.attachments.bytes);
    statStorage.textContent = formatBytes(current.storageBytes);
    statStorageSub.textContent = 'all stored versions, deduplicated';

    // Devices table.
    deviceError.textContent = '';
    clear(deviceBody);
    const rows = deviceRows(current.devices, now);
    if (rows.length === 0) {
      deviceBody.append(emptyRow('No devices paired yet.'));
    }
    for (const row of rows) deviceBody.append(deviceRow(row));

    // Events feed.
    clear(eventList);
    const names = deviceNameMap(current.devices);
    const feed = eventRows(current.recentEvents, names, now);
    if (feed.length === 0) eventList.append(h('li', { class: 'event-empty', text: 'Nothing yet.' }));
    for (const eventRow of feed) eventList.append(eventLi(eventRow));
  }

  function deviceRow(row: DeviceRowModel): HTMLTableRowElement {
    const revoke = row.canRevoke
      ? quietButton('Revoke', () => void revokeDevice(row))
      : h('span', { class: 'muted', text: '—' });
    return h(
      'tr',
      { class: row.status === 'revoked' ? 'row-revoked' : undefined },
      h('td', { class: 'cell-strong' }, row.name),
      h('td', { text: row.type }),
      h('td', undefined, badge(row.status, row.status)),
      h('td', { class: 'muted', text: row.lastSeen }),
      h('td', undefined, revoke),
    );
  }

  function emptyRow(text: string): HTMLTableRowElement {
    return h('tr', undefined, h('td', { class: 'event-empty', colspan: '5', text }));
  }

  function eventLi(row: EventRowModel): HTMLLIElement {
    return h(
      'li',
      { class: 'event-item' },
      h('span', { class: `event-dot event-${row.kind}` }),
      h('span', { class: 'event-label', text: row.label }),
      row.path !== null ? h('code', { class: 'event-path', text: row.path }) : h('span', { class: 'event-path muted', text: '—' }),
      h('span', { class: 'event-device muted', text: row.deviceName }),
      h('span', { class: 'event-time muted', text: row.time }),
    );
  }

  async function revokeDevice(row: DeviceRowModel): Promise<void> {
    if (!window.confirm(`Revoke ${row.name}? Its token stops working immediately; other devices are unaffected.`)) {
      return;
    }
    try {
      await api.adminRevoke(row.id);
      await load();
    } catch (error) {
      handleApiError(error, 'Revoke failed');
    }
  }

  // --- pair-a-device modal -----------------------------------------------------------------

  function openPairModal(): void {
    closeModal(); // one at a time
    const name = h('input', { class: 'input', type: 'text', placeholder: 'e.g. Pixel 9', autocomplete: 'off' }) as HTMLInputElement;
    const type = h('select', { class: 'input' }, ...DEVICE_TYPES.map((t) => h('option', { value: t, text: t }))) as HTMLSelectElement;
    type.value = 'desktop';

    const errorLine = h('p', { class: 'form-error', role: 'alert' });
    const body = h('div', undefined);
    const generate = primaryButton('Generate pairing code', () => void mint());

    const dialog = h(
      'div',
      { class: 'modal-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Pair a device' },
      h('div', { class: 'card-head' }, h('h2', { text: 'Pair a device' }), quietButton('Close', closeModal)),
      h(
        'form',
        {
          onsubmit: (event: Event) => {
            event.preventDefault();
            void mint();
          },
        },
        field('Device name', name),
        field('Device type', type),
        errorLine,
        h('div', { class: 'form-actions' }, generate),
      ),
      body,
    );

    async function mint(): Promise<void> {
      errorLine.textContent = '';
      const deviceName = name.value.trim();
      if (deviceName.length === 0) {
        errorLine.textContent = 'Give the device a name.';
        return;
      }
      generate.disabled = true;
      generate.textContent = 'Generating…';
      try {
        const pairDoc = await api.adminPair(deviceName, type.value);
        ctx.dispatch({ type: 'network-ok' });
        panel?.dispose();
        const pair = pairingPanel(pairDoc);
        panel = pair;
        clear(body);
        body.append(
          pair.root,
          h(
            'div',
            { class: 'form-actions' },
            primaryButton('Generate another', () => {
              panel?.dispose();
              panel = null;
              clear(body);
              generate.disabled = false;
              generate.textContent = 'Generate pairing code';
            }),
          ),
        );
      } catch (error) {
        generate.disabled = false;
        generate.textContent = 'Generate pairing code';
        if (error instanceof ApiError && (error.kind === 'unauthorized' || error.kind === 'unclaimed')) {
          closeModal();
          handleApiError(error, 'Pairing failed');
          return;
        }
        handleApiError(error, 'Could not mint a pairing code');
      }
    }

    overlay = h('div', { class: 'modal-overlay', onclick: (event: Event) => {
      if (event.target === overlay) closeModal();
    } }, dialog);
    root.append(overlay);
    name.focus();
  }

  function closeModal(): void {
    panel?.dispose();
    panel = null;
    overlay?.remove();
    overlay = null;
  }

  // --- wiring -------------------------------------------------------------------------------

  void load();
  const timer = window.setInterval(() => void load(), REFRESH_MS);

  return {
    root,
    refresh(): void {
      void load();
    },
    dispose(): void {
      disposed = true;
      window.clearInterval(timer);
      closeModal();
    },
  };
}

function statCard(title: string, value: HTMLElement, sub: HTMLElement): HTMLElement {
  return h(
    'div',
    { class: 'card stat-card' },
    h('div', { class: 'stat-title', text: title }),
    value,
    sub,
  );
}
