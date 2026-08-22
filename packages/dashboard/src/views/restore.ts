/**
 * Restore browsing (read-only) — version list for one path with per-version
 * download (GET /blob/:hash rides the admin cookie), plus a pointer to
 * `vsa restore` for actually putting an old version back into the vault
 * (FR-54; restore itself is a client-side commit, §5).
 */

import { api, ApiError } from '../api.js';
import { badge, clear, h, primaryButton, quietButton, textInput } from '../dom.js';
import { deviceNameMap, versionRows } from '../rows.js';
import type { HistoryDoc } from '../types.js';
import type { ViewContext, ViewHandle } from '../view.js';

export function restoreView(ctx: ViewContext): ViewHandle {
  const pathInput = textInput({ name: 'path', placeholder: '/notes/something.md' });
  const errorLine = h('p', { class: 'form-error', role: 'alert' });
  const resultHead = h('p', { class: 'result-head' });
  const tbody = h('tbody');
  const tableWrap = h('div', { class: 'table-wrap', hidden: true },
    h(
      'table',
      { class: 'table' },
      h(
        'thead',
        undefined,
        h('tr', undefined, h('th', { text: 'Time' }), h('th', { text: 'Device' }), h('th', { text: 'Kind' }), h('th', { text: 'Size' }), h('th', { text: '' })),
      ),
      tbody,
    ),
  );

  const load = primaryButton('Show versions', () => void loadHistory());

  const root = h(
    'div',
    { class: 'page' },
    h(
      'header',
      { class: 'page-header' },
      h('div', { class: 'page-title' }, h('h1', { text: 'Restore' })),
      h(
        'nav',
        { class: 'page-nav' },
        quietButton('Dashboard', () => ctx.dispatch({ type: 'navigate', view: 'status' })),
        quietButton('Restore', () => ctx.dispatch({ type: 'navigate', view: 'restore' }), { 'data-active': true }),
        quietButton('Sign out', () => void signOut()),
      ),
    ),
    h(
      'section',
      { class: 'card' },
      h(
        'form',
        {
          class: 'restore-form',
          onsubmit: (event: Event) => {
            event.preventDefault();
            void loadHistory();
          },
        },
        pathInput,
        load,
      ),
      errorLine,
      h(
        'p',
        { class: 'muted restore-hint' },
        'Read-only browsing. To put an old version back into your vault run ',
        h('code', { text: 'vsa restore <path> --version <version id>' }),
        ' — the dashboard never writes.',
      ),
      resultHead,
      tableWrap,
    ),
  );

  async function signOut(): Promise<void> {
    // Best effort: clear the cookie server-side, then leave regardless — an
    // unreachable server must not trap the admin in an authenticated view.
    try {
      await api.adminLogout();
    } catch {
      // the cookie dies on its own 12 h TTL (or the next login)
    }
    ctx.dispatch({ type: 'logged-out' });
  }

  async function loadHistory(): Promise<void> {
    errorLine.textContent = '';
    const raw = pathInput.value.trim();
    if (raw.length === 0) {
      errorLine.textContent = 'Enter a vault path, e.g. /notes/something.md';
      return;
    }
    const path = raw.startsWith('/') ? raw : `/${raw}`;

    load.disabled = true;
    load.textContent = 'Loading…';
    try {
      // Device names for the version list (also keeps the session warm).
      const [status, history] = await Promise.all([api.status(), api.history(path)]);
      ctx.dispatch({ type: 'network-ok' });
      renderHistory(history, deviceNameMap(status.devices));
    } catch (error) {
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
          errorLine.textContent = 'Cannot reach the server — check your connection.';
          return;
        }
        errorLine.textContent = error.message;
      } else {
        errorLine.textContent = 'Unexpected error — try again.';
      }
    } finally {
      load.disabled = false;
      load.textContent = 'Show versions';
    }
  }

  function renderHistory(history: HistoryDoc, names: Map<string, string>): void {
    const now = Date.now();
    clear(tbody);
    if (history.head === null) {
      resultHead.textContent = `No file at ${history.path} — check the path.`;
      tableWrap.hidden = true;
      return;
    }
    resultHead.textContent = `${history.path}${history.head.deleted ? ' (in trash — restorable)' : ''}`;
    tableWrap.hidden = false;
    const rows = versionRows(history.versions, names, now);
    if (rows.length === 0) {
      tbody.append(h('tr', undefined, h('td', { class: 'event-empty', colspan: '5', text: 'No versions recorded.' })));
    }
    for (const row of rows) {
      tbody.append(
        h(
          'tr',
          { class: row.current ? 'row-current' : undefined },
          h('td', undefined, h('span', { text: row.time, title: row.absolute }), ...(row.current ? [badge('current', 'ok')] : [])),
          h('td', { text: row.deviceName }),
          h('td', { class: 'muted', text: row.kind }),
          h('td', { class: 'muted', text: row.size }),
          h(
            'td',
            undefined,
            row.downloadable
              ? h('a', { class: 'btn btn-quiet', href: `/blob/${row.hash}`, download: downloadName(history.path, row.hash), text: 'Download' })
              : h('span', { class: 'muted', text: '—' }),
          ),
        ),
      );
    }
  }

  return {
    root,
    refresh(): void {
      if (pathInput.value.trim().length > 0) void loadHistory();
    },
  };
}

function downloadName(path: string, hash: string): string {
  const base = path.split('/').pop() ?? 'blob';
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  return `${stem}-${hash.slice(0, 8)}${ext}`;
}
