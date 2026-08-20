/**
 * State machine tests — the claim/login/session branching (FR-30..FR-32)
 * and the defensive 401/421/network transitions.
 */
import { describe, expect, it } from 'vitest';
import { INITIAL_STATE, reduce, type AppEvent } from '../src/state.js';

function walk(events: AppEvent[]): ReturnType<typeof reduce> {
  return events.reduce(reduce, INITIAL_STATE);
}

describe('bootstrap branching', () => {
  it('routes a fresh unclaimed worker to the claim view', () => {
    const state = walk([{ type: 'bootstrap', claimed: false }]);
    expect(state.view).toBe('claim');
    expect(state.offline).toBe(false);
  });

  it('routes a claimed worker to the login view', () => {
    const state = walk([{ type: 'bootstrap', claimed: true }]);
    expect(state.view).toBe('login');
  });

  it('skips login when a valid admin cookie is found (session probe)', () => {
    const state = walk([{ type: 'bootstrap', claimed: true }, { type: 'session-ok' }]);
    expect(state.view).toBe('status');
  });

  it('stays on login when the session probe answers 401', () => {
    const state = walk([{ type: 'bootstrap', claimed: true }, { type: 'unauthorized' }]);
    expect(state.view).toBe('login');
    expect(state.message).toContain('Session expired');
  });
});

describe('claim flow', () => {
  it('lands on status after the full claim flow', () => {
    const state = walk([{ type: 'bootstrap', claimed: false }, { type: 'claim-done' }]);
    expect(state.view).toBe('status');
  });

  it('a 409 from claim switches to login with a helpful message', () => {
    const state = walk([{ type: 'bootstrap', claimed: false }, { type: 'already-claimed' }]);
    expect(state.view).toBe('login');
    expect(state.message).toContain('already been claimed');
  });

  it('login-ok lands on status and clears stale messages', () => {
    const state = walk([
      { type: 'bootstrap', claimed: true },
      { type: 'unauthorized' },
      { type: 'login-ok' },
    ]);
    expect(state.view).toBe('status');
    expect(state.message).toBeNull();
  });
});

describe('defensive transitions', () => {
  it('network errors never change the view — only raise the banner', () => {
    const states = [
      walk([{ type: 'bootstrap', claimed: false }]), // claim view
      walk([{ type: 'bootstrap', claimed: true }]), // login view
      walk([{ type: 'login-ok' }]), // status view
      walk([{ type: 'login-ok' }, { type: 'navigate', view: 'restore' }]), // restore view
    ];
    for (const before of states) {
      const after = reduce(before, { type: 'network-error' });
      expect(after.view).toBe(before.view);
      expect(after.offline).toBe(true);
    }
  });

  it('network-ok clears the banner without re-render churn', () => {
    const offline = walk([{ type: 'network-error' }]);
    const recovered = reduce(offline, { type: 'network-ok' });
    expect(recovered.offline).toBe(false);
    // Already-online stays the exact same object (no re-render).
    expect(reduce(INITIAL_STATE, { type: 'network-ok' })).toBe(INITIAL_STATE);
  });

  it('a 421 mid-session collapses to the claim view (worker reset)', () => {
    const state = walk([{ type: 'bootstrap', claimed: true }, { type: 'login-ok' }, { type: 'unclaimed' }]);
    expect(state.view).toBe('claim');
    expect(state.message).toBeNull();
  });

  it('a 401 mid-session collapses to login with a message', () => {
    const state = walk([{ type: 'bootstrap', claimed: true }, { type: 'login-ok' }, { type: 'unauthorized' }]);
    expect(state.view).toBe('login');
    expect(state.message).toContain('sign in again');
  });
});

describe('navigation', () => {
  it('toggles between status and restore', () => {
    const state = walk([{ type: 'login-ok' }, { type: 'navigate', view: 'restore' }]);
    expect(state.view).toBe('restore');
    expect(reduce(state, { type: 'navigate', view: 'status' }).view).toBe('status');
  });

  it('signing out returns to login', () => {
    const state = walk([{ type: 'login-ok' }, { type: 'logged-out' }]);
    expect(state.view).toBe('login');
    expect(state.message).toBe('Signed out.');
  });
});
