/**
 * Diagnostics (the Advanced section's log level + "Copy diagnostics"):
 * the ring buffer is bounded and level-gated, the round-trip wrapper logs one
 * short line per frame at debug only, and the bundle carries the full payload
 * shape the spec demands (versions, identity, worker, pairing state, client
 * status snapshot, platform, last N log lines).
 */

import { describe, expect, it, vi } from 'vitest';
import { ProtocolVersion } from '@vsa/core';
import type { Message, Transport } from '@vsa/core';
import {
  buildDiagnosticsBundle,
  copyToClipboard,
  createPluginLog,
  describeMessage,
  formatBytes,
  platformSummary,
  RING_CAPACITY,
  withRoundTripLogging,
} from '../src/diagnostics.js';
import type { SyncClientStatus } from '@vsa/core';
import { resetObsidianMock, Platform } from './helpers/obsidian-mock.js';

const status = (partial: Partial<SyncClientStatus>): SyncClientStatus => ({
  state: 'live',
  lastSyncAt: null,
  pending: 0,
  conflicts: [],
  ...partial,
});

describe('createPluginLog — bounded ring buffer', () => {
  it('keeps only the last `capacity` lines, oldest first', () => {
    const log = createPluginLog({ capacity: 5, now: () => 1_700_000_000_000 });
    for (let i = 1; i <= 12; i++) log.info(`line ${i}`);
    const lines = log.recentLines();
    expect(lines).toHaveLength(5);
    expect(lines[0]).toContain('line 8'); // the oldest survivor
    expect(lines[4]).toContain('line 12'); // the newest
    // Each line is prefixed with an ISO timestamp and the severity.
    expect(lines[0]!).toMatch(/^2023-11-14T22:13:20\.000Z \[info\] line 8$/);
  });

  it('the default capacity is the spec 20 (last 20 log lines)', () => {
    const log = createPluginLog();
    for (let i = 0; i < RING_CAPACITY + 9; i++) log.info(`x${i}`);
    const lines = log.recentLines();
    expect(lines).toHaveLength(RING_CAPACITY);
    expect(lines.at(-1)).toContain(`x${RING_CAPACITY + 8}`);
  });

  it('recentLines returns a copy — callers cannot mutate the ring', () => {
    const log = createPluginLog();
    log.info('only line');
    log.recentLines().length = 0;
    expect(log.recentLines()).toHaveLength(1);
  });
});

describe('createPluginLog — level gate', () => {
  it('default info: debug is dropped, info/warn/error kept', () => {
    const log = createPluginLog();
    log.debug('hidden');
    log.info('kept-info');
    log.warn('kept-warn');
    log.error('kept-error');
    const lines = log.recentLines();
    expect(lines).toHaveLength(3);
    expect(lines.some((l) => l.includes('hidden'))).toBe(false);
    expect(log.getLevel()).toBe('info');
    expect(log.debugEnabled).toBe(false);
  });

  it('warn level keeps only warn+error; setLevel takes effect immediately', () => {
    const log = createPluginLog();
    log.setLevel('warn');
    expect(log.getLevel()).toBe('warn');
    log.info('dropped');
    log.debug('dropped too');
    log.warn('kept');
    log.error('kept');
    expect(log.recentLines()).toHaveLength(2);
  });

  it('debug level records everything and enables round-trip logging', () => {
    const log = createPluginLog();
    log.setLevel('debug');
    log.debug('now visible');
    expect(log.debugEnabled).toBe(true);
    expect(log.recentLines().some((l) => l.includes('now visible'))).toBe(true);
  });

  it('long arguments are truncated; errors render name+message', () => {
    const log = createPluginLog({ capacity: 10 });
    log.info('x'.repeat(500));
    const line = log.recentLines()[0]!;
    // Timestamp + severity prefix, then at most ~300 chars of the argument.
    expect(line.length).toBeLessThan(24 + 8 + 310);
    expect((line.match(/x+/)?.[0] ?? '').length).toBeLessThanOrEqual(300);
    expect(line.endsWith('…')).toBe(true);
    log.info('failed', new Error('boom'));
    expect(log.recentLines()[1]).toContain('Error: boom');
  });
});

describe('withRoundTripLogging', () => {
  /** A transport that records sends and lets the test deliver replies. */
  function fakeTransport(): {
    transport: Transport;
    sent: string[];
    deliver: (message: Message) => void;
  } {
    const sent: string[] = [];
    let deliver: (message: Message) => void = () => {};
    const transport: Transport = {
      send: (message) => {
        sent.push(message.type);
      },
      onMessage: (callback) => {
        deliver = callback;
      },
      onClose: () => {},
      close: () => {},
    };
    return { transport, sent, deliver: (message) => deliver(message) };
  }

  it('logs one short line per frame at debug level only', () => {
    const log = createPluginLog();
    log.setLevel('debug');
    const inner = fakeTransport();
    const wrapped = withRoundTripLogging(inner.transport, {
      log,
      shouldLog: () => log.debugEnabled,
    });

    let received: Message | null = null;
    wrapped.onMessage((m) => {
      received = m;
    });
    wrapped.send({ type: 'getManifest' });
    inner.deliver({ type: 'manifest', entries: {}, cursor: 0 });

    expect(inner.sent).toEqual(['getManifest']);
    expect(received!.type).toBe('manifest');
    const lines = log.recentLines();
    expect(lines.some((l) => l.includes('[debug] → getManifest'))).toBe(true);
    expect(lines.some((l) => l.includes('[debug] ← manifest'))).toBe(true);
  });

  it('is silent (and cheap) below debug level', () => {
    const log = createPluginLog(); // info
    const inner = fakeTransport();
    const wrapped = withRoundTripLogging(inner.transport, {
      log,
      shouldLog: () => log.debugEnabled,
    });
    wrapped.send({ type: 'getManifest' });
    expect(log.recentLines()).toHaveLength(0);
  });
});

describe('describeMessage', () => {
  it('compresses a frame to type + identity keys', () => {
    expect(describeMessage({ type: 'commit', path: '/a.md', hash: 'abcdef0123456789' })).toBe(
      'commit /a.md abcdef012345',
    );
    expect(describeMessage({ type: 'change', seq: 4, path: '/b.md' })).toBe('change /b.md seq 4');
    expect(describeMessage({ type: 'hello', cursor: 9 })).toBe('hello cursor 9');
    expect(describeMessage({ type: 'commit', fromPath: '/old.md', path: '/new.md' })).toBe(
      'commit /old.md → /new.md',
    );
  });
});

describe('buildDiagnosticsBundle — payload shape', () => {
  const base = {
    pluginVersion: '1.4.2',
    deviceId: 'dev-abc123',
    deviceName: 'MacBook',
    workerUrl: 'https://personal.x.workers.dev',
    paired: true,
    paused: false,
    clientStatus: status({ lastSyncAt: Date.now() - 5_000, pending: 2 }),
    recentLogLines: ['2026-01-01T00:00:00.000Z [info] hello', '2026-01-01T00:00:01.000Z [warn] bye'],
  };

  it('carries versions, identity, worker, pairing, status snapshot, platform, logs', () => {
    resetObsidianMock(); // desktop platform flags
    const bundle = buildDiagnosticsBundle(base);
    const lines = bundle.split('\n');
    expect(lines[0]).toBe('VaultSync for Agents — diagnostics');
    expect(bundle).toContain(`Plugin version: 1.4.2`);
    expect(bundle).toContain(`Protocol version: ${ProtocolVersion}`);
    expect(bundle).toContain('Device: dev-abc123 (MacBook)');
    expect(bundle).toContain('Worker: https://personal.x.workers.dev');
    expect(bundle).toContain('Pairing: paired');
    expect(bundle).toContain('Sync: live,');
    expect(bundle).toContain('pending 2, conflicts 0');
    expect(bundle).toContain('Platform: Obsidian desktop app');
    expect(bundle).toContain('Recent log (last 2 lines):');
    expect(bundle).toContain('  2026-01-01T00:00:00.000Z [info] hello');
    expect(bundle).toContain('  2026-01-01T00:00:01.000Z [warn] bye');
  });

  it('covers the not-running, paused, and unpaired readouts', () => {
    expect(buildDiagnosticsBundle({ ...base, clientStatus: null })).toContain('Sync: not running');
    expect(buildDiagnosticsBundle({ ...base, paused: true })).toContain('Sync: paused');
    const unpaired = buildDiagnosticsBundle({
      ...base,
      paired: false,
      deviceId: '',
      deviceName: '',
      workerUrl: '',
      clientStatus: null,
      recentLogLines: [],
    });
    expect(unpaired).toContain('Pairing: not paired');
    expect(unpaired).toContain('Device: (unassigned)');
    expect(unpaired).toContain('Worker: (not configured)');
    expect(unpaired).toContain('(no recorded log lines)');
  });
});

describe('copyToClipboard / formatBytes / platformSummary', () => {
  it('writes through navigator.clipboard and resolves true', async () => {
    const captured: string[] = [];
    vi.stubGlobal('navigator', {
      clipboard: { writeText: async (t: string) => void captured.push(t) },
    });
    try {
      await expect(copyToClipboard('diag bundle')).resolves.toBe(true);
      expect(captured).toEqual(['diag bundle']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('resolves false when the clipboard is missing or rejects', async () => {
    vi.stubGlobal('navigator', {});
    try {
      await expect(copyToClipboard('x')).resolves.toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
    vi.stubGlobal('navigator', {
      clipboard: { writeText: async () => Promise.reject(new Error('denied')) },
    });
    try {
      await expect(copyToClipboard('x')).resolves.toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('formats bytes for the About storage line', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(730)).toBe('730 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(1_200_000)).toBe('1.1 MB');
    expect(formatBytes(5_000_000_000)).toBe('4.7 GB');
  });

  it('summarizes the platform flags (mobile readouts included)', () => {
    resetObsidianMock();
    expect(platformSummary()).toBe('Obsidian desktop app');
    Object.assign(Platform, { isMobileApp: true, isIosApp: true, isTablet: false, isPhone: true });
    expect(platformSummary()).toBe('Obsidian mobile app (iOS, phone)');
  });
});
