/**
 * The dashboard's view state machine (pure — no DOM, no fetch).
 *
 * Bootstrap: `GET /health` decides claim vs. login; a session probe then
 * decides login vs. status. Defensive transitions: any 401 collapses to the
 * login view with a message, any 421 collapses to the claim view (the worker
 * was reset/unclaimed under us), and network errors NEVER change the view —
 * they only raise the offline banner so the last rendered data stays visible.
 */

export type View = 'loading' | 'claim' | 'login' | 'status' | 'restore';

export interface AppState {
  view: View;
  /** True while requests fail with network errors (offline banner). */
  offline: boolean;
  /** One-shot message shown on the login view (e.g. "session expired"). */
  message: string | null;
}

export type AppEvent =
  /** Health probe answered: route to the claim or login view. */
  | { type: 'bootstrap'; claimed: boolean }
  /** Session probe on boot answered 200: an admin cookie is still valid. */
  | { type: 'session-ok' }
  /** The full claim flow (claim + login + first pairing code) succeeded. */
  | { type: 'claim-done' }
  /** Admin login succeeded. */
  | { type: 'login-ok' }
  /** User pressed "sign out". */
  | { type: 'logged-out' }
  /** Claim POST answered 409: someone claimed this worker already. */
  | { type: 'already-claimed' }
  /** A request answered 401. */
  | { type: 'unauthorized' }
  /** A request answered 421 (worker became unclaimed). */
  | { type: 'unclaimed' }
  /** A request failed at the network layer. */
  | { type: 'network-error' }
  /** A request succeeded again. */
  | { type: 'network-ok' }
  /** Authenticated-view navigation (status <-> restore). */
  | { type: 'navigate'; view: 'status' | 'restore' };

export const INITIAL_STATE: AppState = { view: 'loading', offline: false, message: null };

export function reduce(state: AppState, event: AppEvent): AppState {
  switch (event.type) {
    case 'bootstrap':
      return { ...state, view: event.claimed ? 'login' : 'claim', message: null };
    case 'session-ok':
    case 'claim-done':
    case 'login-ok':
      return { ...state, view: 'status', offline: false, message: null };
    case 'logged-out':
      return { ...state, view: 'login', message: 'Signed out.' };
    case 'already-claimed':
      return { ...state, view: 'login', message: 'This worker has already been claimed — sign in with its passphrase.' };
    case 'unauthorized':
      return { ...state, view: 'login', offline: false, message: 'Session expired — sign in again.' };
    case 'unclaimed':
      return { ...state, view: 'claim', offline: false, message: null };
    case 'network-error':
      return { ...state, offline: true };
    case 'network-ok':
      return state.offline ? { ...state, offline: false } : state;
    case 'navigate':
      return { ...state, view: event.view };
    default: {
      // Exhaustiveness guard (noFallthroughCasesInSwitch + never default).
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}
