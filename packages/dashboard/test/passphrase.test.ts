/**
 * Admin passphrase-change tests — the pure form model (validation, lifecycle
 * reducer, render model), the feed label for the rotation event, and the
 * stale-session collapse the rotation triggers in OTHER tabs (a state machine
 * walk: their cookies die with the rotated secret, their next poll 401s).
 */
import { describe, expect, it } from 'vitest';
import {
  INITIAL_PASSPHRASE_FORM,
  PASSPHRASE_CHANGED_NOTICE,
  passphraseFormView,
  reducePassphraseForm,
  validatePassphraseChange,
  type PassphraseFormState,
} from '../src/passphrase.js';
import { eventLabel } from '../src/rows.js';
import { INITIAL_STATE, reduce, type AppEvent } from '../src/state.js';

function walk(events: AppEvent[], from: PassphraseFormState = INITIAL_PASSPHRASE_FORM): PassphraseFormState {
  return events.reduce(reducePassphraseForm, from);
}

describe('validatePassphraseChange (inline form validation)', () => {
  const base = { current: 'old-one', next: 'new-one', confirm: 'new-one' };

  it('accepts a complete, matching form', () => {
    expect(validatePassphraseChange(base)).toBeNull();
  });

  it('rejects an empty current passphrase', () => {
    expect(validatePassphraseChange({ ...base, current: '' })).toBe('Enter your current passphrase.');
  });

  it('rejects a too-short (or empty) next passphrase — mirrors the claim rule', () => {
    expect(validatePassphraseChange({ ...base, next: 'abc', confirm: 'abc' })).toBe(
      'New passphrase must be at least 4 characters.',
    );
    expect(validatePassphraseChange({ ...base, next: '', confirm: '' })).toContain('at least 4 characters');
  });

  it('rejects a confirm mismatch', () => {
    expect(validatePassphraseChange({ ...base, confirm: 'different' })).toBe(
      'New passphrases do not match.',
    );
  });

  it('allows next === current (the server still rotates salt + secret)', () => {
    expect(validatePassphraseChange({ current: 'same-one', next: 'same-one', confirm: 'same-one' })).toBeNull();
  });
});

describe('form lifecycle (reducePassphraseForm)', () => {
  it('opens into editing (no error) and cancels back to closed', () => {
    const opened = walk([{ type: 'open' }]);
    expect(opened).toEqual({ phase: 'editing', error: null });
    expect(walk([{ type: 'cancel' }], opened)).toBe(INITIAL_PASSPHRASE_FORM);
  });

  it('a validation failure stays in editing and carries the message', () => {
    const state = walk([{ type: 'open' }, { type: 'validation-failed', error: 'New passphrases do not match.' }]);
    expect(state).toEqual({ phase: 'editing', error: 'New passphrases do not match.' });
  });

  it('submit locks the form; success swaps to the notice; failure returns to editing', () => {
    const submitting = walk([{ type: 'open' }, { type: 'submit' }]);
    expect(submitting).toEqual({ phase: 'submitting' });
    const done = walk([{ type: 'succeeded' }], submitting);
    expect(done).toEqual({ phase: 'success', notice: PASSPHRASE_CHANGED_NOTICE });
    const failed = walk([{ type: 'failed', error: 'nope' }], submitting);
    expect(failed).toEqual({ phase: 'editing', error: 'nope' });
  });

  it('the notice dismisses (auto or by hand) and the form can reopen', () => {
    const noticed = walk([{ type: 'open' }, { type: 'submit' }, { type: 'succeeded' }]);
    expect(walk([{ type: 'dismissed' }], noticed)).toBe(INITIAL_PASSPHRASE_FORM);
    expect(walk([{ type: 'open' }], noticed)).toEqual({ phase: 'editing', error: null });
  });

  it('reset collapses from any phase (stale session / view dispose)', () => {
    for (const state of [
      walk([{ type: 'open' }, { type: 'submit' }]),
      walk([{ type: 'open' }, { type: 'submit' }, { type: 'succeeded' }]),
      walk([{ type: 'open' }]),
    ]) {
      expect(walk([{ type: 'reset' }], state)).toBe(INITIAL_PASSPHRASE_FORM);
    }
  });
});

describe('render model (what the DOM shows per phase)', () => {
  it('closed: only the toggle; no form, no messages', () => {
    const view = passphraseFormView(INITIAL_PASSPHRASE_FORM);
    expect(view).toEqual({
      formVisible: false,
      errorText: null,
      noticeText: null,
      submitDisabled: false,
      submitLabel: 'Change passphrase',
    });
  });

  it('editing: form visible, error text rendered when present', () => {
    expect(passphraseFormView({ phase: 'editing', error: null }).formVisible).toBe(true);
    expect(passphraseFormView({ phase: 'editing', error: 'boom' }).errorText).toBe('boom');
  });

  it('submitting: form locked and relabelled while in flight', () => {
    const view = passphraseFormView({ phase: 'submitting' });
    expect(view.formVisible).toBe(true);
    expect(view.submitDisabled).toBe(true);
    expect(view.submitLabel).toBe('Changing…');
  });

  it('success: form hidden, notice up (mentions other sessions + devices)', () => {
    const view = passphraseFormView({ phase: 'success', notice: PASSPHRASE_CHANGED_NOTICE });
    expect(view.formVisible).toBe(false);
    expect(view.noticeText).toBe(PASSPHRASE_CHANGED_NOTICE);
    expect(view.noticeText).toContain('other admin sessions');
    expect(view.noticeText).toContain('Devices keep syncing');
  });
});

describe('rotation event in the feed', () => {
  it('labels the worker\'s passphrase_changed event', () => {
    expect(eventLabel('passphrase_changed')).toBe('Passphrase changed');
  });
});

describe('stale sessions after a rotation (other tabs)', () => {
  it('a 401 from a dead post-rotation cookie collapses any authenticated view to login', () => {
    // Another tab rotated the passphrase: this tab's cookie was signed with
    // the old secret, so its next /api/status poll answers 401.
    const status = [{ type: 'login-ok' }].reduce(reduce, INITIAL_STATE);
    const restore = [
      { type: 'login-ok' },
      { type: 'navigate', view: 'restore' as const },
    ].reduce(reduce, INITIAL_STATE);
    for (const before of [status, restore]) {
      const after = reduce(before, { type: 'unauthorized' });
      expect(after.view).toBe('login');
      expect(after.message).toContain('sign in again');
    }
  });

  it('re-login with the new passphrase lands back on status, message cleared', () => {
    const state = [
      { type: 'login-ok' },
      { type: 'unauthorized' },
      { type: 'login-ok' },
    ].reduce(reduce, INITIAL_STATE);
    expect(state.view).toBe('status');
    expect(state.message).toBeNull();
  });
});
