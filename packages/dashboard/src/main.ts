/**
 * App controller — owns the AppState, mounts the active view, renders the
 * offline banner, and runs the bootstrap branch (GET /health decides claim
 * vs. login; a session probe decides login vs. status).
 */

import './styles.css';
import { api, ApiError } from './api.js';
import { clear, h, quietButton, spinner } from './dom.js';
import { INITIAL_STATE, reduce, type AppEvent, type AppState } from './state.js';
import { claimView } from './views/claim.js';
import { loginView } from './views/login.js';
import { restoreView } from './views/restore.js';
import { statusView } from './views/status.js';
import type { ViewHandle } from './view.js';

const appHost = document.querySelector<HTMLElement>('#app') as HTMLElement;
const bannerHost = document.querySelector<HTMLElement>('#banner') as HTMLElement;

let state: AppState = INITIAL_STATE;
let current: ViewHandle | null = null;

function dispatch(event: AppEvent): void {
  const next = reduce(state, event);
  if (next === state) return;
  state = next;
  render();
}

function render(): void {
  current?.dispose?.();
  current = null;
  clear(appHost);
  switch (state.view) {
    case 'loading':
      appHost.append(h('div', { class: 'auth-wrap' }, spinner('Connecting to your worker…')));
      break;
    case 'claim':
      current = claimView({ dispatch });
      break;
    case 'login':
      current = loginView({ dispatch }, state.message);
      break;
    case 'status':
      current = statusView({ dispatch });
      break;
    case 'restore':
      current = restoreView({ dispatch });
      break;
  }
  if (current !== null) appHost.append(current.root);
  renderBanner();
}

function renderBanner(): void {
  clear(bannerHost);
  if (!state.offline) return;
  bannerHost.append(
    h(
      'div',
      { class: 'offline-banner', role: 'alert' },
      h('span', { text: 'Connection lost — retrying automatically.' }),
      quietButton('Retry now', () => retry()),
    ),
  );
}

function retry(): void {
  const refresh = current?.refresh;
  if (refresh !== undefined) refresh();
  else void bootstrap();
}

async function bootstrap(): Promise<void> {
  try {
    const health = await api.health();
    dispatch({ type: 'bootstrap', claimed: health.claimed });
    if (health.claimed) {
      // An admin cookie may still be valid — probe before showing login.
      try {
        await api.status();
        dispatch({ type: 'session-ok' });
      } catch (probeError) {
        if (probeError instanceof ApiError && probeError.kind === 'unauthorized') {
          return; // plain login view
        }
        if (probeError instanceof ApiError && probeError.kind === 'unclaimed') {
          dispatch({ type: 'unclaimed' });
          return;
        }
        throw probeError;
      }
    }
  } catch {
    // Health itself unreachable: stay on the loading view with the banner.
    dispatch({ type: 'network-error' });
  }
}

render();
void bootstrap();
