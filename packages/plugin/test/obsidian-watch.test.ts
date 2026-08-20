import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ObsidianWatchAdapter, RescanScheduler } from '../src/adapters/obsidian-watch.js';
import type { FileChangeEvent } from '@vsa/core';
import { FakeVault } from './helpers/fake-vault.js';
import type { Vault } from 'obsidian';

describe('ObsidianWatchAdapter', () => {
  it('maps vault create/modify/delete events to core file-change events', () => {
    const vault = new FakeVault();
    const adapter = new ObsidianWatchAdapter({ vault: vault as unknown as Vault });
    const events: FileChangeEvent[] = [];
    adapter.start((batch) => events.push(...batch));

    vault.emit('create', { path: 'notes/new.md' });
    vault.emit('modify', { path: 'notes/new.md' });
    vault.emit('delete', { path: 'notes/new.md' });

    expect(events).toEqual([
      { kind: 'add', path: '/notes/new.md' },
      { kind: 'modify', path: '/notes/new.md' },
      { kind: 'delete', path: '/notes/new.md' },
    ]);
  });

  it('maps rename events with old path → new path', () => {
    const vault = new FakeVault();
    const adapter = new ObsidianWatchAdapter({ vault: vault as unknown as Vault });
    const events: FileChangeEvent[] = [];
    adapter.start((batch) => events.push(...batch));

    vault.emit('rename', { path: 'notes/renamed.md' }, 'notes/original.md');

    expect(events).toEqual([
      { kind: 'rename', path: '/notes/original.md', toPath: '/notes/renamed.md' },
    ]);
  });

  it('forwards folder events too (empty-folder sync triggers, FR-10)', () => {
    const vault = new FakeVault();
    const adapter = new ObsidianWatchAdapter({ vault: vault as unknown as Vault });
    const events: FileChangeEvent[] = [];
    adapter.start((batch) => events.push(...batch));

    vault.emit('create', { path: 'new-folder' });
    expect(events).toEqual([{ kind: 'add', path: '/new-folder' }]);
  });

  it('stop() detaches every vault listener', () => {
    const vault = new FakeVault();
    const adapter = new ObsidianWatchAdapter({ vault: vault as unknown as Vault });
    adapter.start(() => {});
    expect(vault.listenerNames).toEqual(['create', 'modify', 'delete', 'rename']);

    adapter.stop();
    expect(vault.listeners).toHaveLength(0);

    const events: FileChangeEvent[] = [];
    adapter.start((batch) => events.push(...batch));
    vault.emit('create', { path: 'x.md' });
    adapter.stop();
    vault.emit('create', { path: 'y.md' });
    expect(events).toEqual([{ kind: 'add', path: '/x.md' }]);
  });
});

describe('RescanScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs a full rescan every intervalMs', () => {
    const scheduler = new RescanScheduler({ intervalMs: 30_000 });
    const runs = vi.fn();
    scheduler.start(runs);

    vi.advanceTimersByTime(29_999);
    expect(runs).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(runs).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(runs).toHaveBeenCalledTimes(3);
  });

  it('poke() schedules one coalesced run after the debounce window', () => {
    const scheduler = new RescanScheduler({ intervalMs: 0, pokeDelayMs: 3000 });
    const runs = vi.fn();
    scheduler.start(runs);

    scheduler.poke();
    scheduler.poke();
    scheduler.poke();
    vi.advanceTimersByTime(2999);
    expect(runs).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(runs).toHaveBeenCalledTimes(1);
    // The poke timer is spent — a new poke schedules again.
    scheduler.poke();
    vi.advanceTimersByTime(3000);
    expect(runs).toHaveBeenCalledTimes(2);
  });

  it('interval 0 disables the periodic timer (vault events only)', () => {
    const scheduler = new RescanScheduler({ intervalMs: 0 });
    const runs = vi.fn();
    scheduler.start(runs);
    vi.advanceTimersByTime(600_000);
    expect(runs).not.toHaveBeenCalled();
  });

  it('setIntervalMs() re-arms a running scheduler', () => {
    const scheduler = new RescanScheduler({ intervalMs: 60_000 });
    const runs = vi.fn();
    scheduler.start(runs);

    scheduler.setIntervalMs(10_000);
    vi.advanceTimersByTime(10_000);
    expect(runs).toHaveBeenCalledTimes(1);

    scheduler.setIntervalMs(0); // off
    vi.advanceTimersByTime(600_000);
    expect(runs).toHaveBeenCalledTimes(1);
  });

  it('stop() clears the periodic timer and any pending poke', () => {
    const scheduler = new RescanScheduler({ intervalMs: 30_000 });
    const runs = vi.fn();
    scheduler.start(runs);
    scheduler.poke();
    scheduler.stop();

    vi.advanceTimersByTime(120_000);
    expect(runs).not.toHaveBeenCalled();
    scheduler.poke(); // stopped: pokes are ignored
    vi.advanceTimersByTime(10_000);
    expect(runs).not.toHaveBeenCalled();
  });
});
