/**
 * `NodeWatchAdapter` event mapping against REAL temp directories (chokidar
 * runs for real; only the coalescing window and awaitWriteFinish are
 * shrunk). Asserts the chokidar → `FileChangeEvent` mapping, ignore rules,
 * temp-file suppression, and batch coalescing.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import type { FileChangeEvent } from '@vsa/core';
import { NodeStorageAdapter } from '@vsa/node-runtime';
import { NodeWatchAdapter } from '../src/watcher.js';

interface Harness {
  root: string;
  events: FileChangeEvent[];
  start(options?: { settings?: { obsidianSync: boolean } }): Promise<void>;
  stop(): Promise<void>;
}

async function makeHarness(): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'vsa-daemon-watch-'));
  const storage = new NodeStorageAdapter({ root });
  const events: FileChangeEvent[] = [];
  let adapter: NodeWatchAdapter | null = null;

  const harness: Harness = {
    root,
    events,
    async start(options = {}) {
      adapter = new NodeWatchAdapter({
        storage,
        settings: options.settings,
        awaitWriteFinish: { stabilityThreshold: 60, pollInterval: 10 },
        batchWindowMs: 120,
      });
      adapter.start((batch) => {
        events.push(...batch);
      });
      // Give chokidar a beat to arm the watcher before the test acts.
      await sleep(150);
    },
    async stop() {
      adapter?.stop();
      adapter = null;
    },
  };
  onTestFinished(() => void adapter?.stop());
  return harness;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function eventually(
  probe: () => boolean,
  timeoutMs = 8_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (probe()) return;
    await sleep(40);
  }
  expect(probe()).toBe(true); // timed out — surface what never happened
}

async function quietPeriod(ms = 350): Promise<void> {
  await sleep(ms);
}

describe('NodeWatchAdapter', () => {
  it('maps chokidar add/change/unlink to core FileChangeEvent kinds', async () => {
    const harness = await makeHarness();
    await writeFile(join(harness.root, 'note.md'), 'v1\n', 'utf8');
    await harness.start();

    await eventually(() => harness.events.some((e) => e.kind === 'add' && e.path === '/note.md'));

    await writeFile(join(harness.root, 'note.md'), 'v2 — agent edit\n', 'utf8');
    await eventually(() => harness.events.some((e) => e.kind === 'modify' && e.path === '/note.md'));

    await rm(join(harness.root, 'note.md'));
    await eventually(() => harness.events.some((e) => e.kind === 'delete' && e.path === '/note.md'));

    await harness.stop();
  });

  it('emits vault paths (posix, rooted) for nested files', async () => {
    const harness = await makeHarness();
    await mkdir(join(harness.root, 'notes', 'deep'), { recursive: true });
    await writeFile(join(harness.root, 'notes', 'deep', 'a.md'), 'x', 'utf8');
    await harness.start();
    await eventually(() => harness.events.some((e) => e.path === '/notes/deep/a.md'));
    await harness.stop();
  });

  it('suppresses ignored paths: .trash, .vaultsyncforagents, .obsidian (off), temp files', async () => {
    const harness = await makeHarness();
    await mkdir(join(harness.root, '.trash'), { recursive: true });
    await mkdir(join(harness.root, '.vaultsyncforagents'), { recursive: true });
    await mkdir(join(harness.root, '.obsidian'), { recursive: true });
    await writeFile(join(harness.root, '.trash', 'deleted.md'), 'x', 'utf8');
    await writeFile(join(harness.root, '.vaultsyncforagents', 'state'), '{}', 'utf8');
    await writeFile(join(harness.root, '.obsidian', 'app.json'), '{}', 'utf8');
    await writeFile(join(harness.root, '.obsidian', 'workspace.json'), '{}', 'utf8');
    await writeFile(join(harness.root, '.note.md.tmp-4242-abc123'), 'partial', 'utf8');
    await writeFile(join(harness.root, 'real.md'), 'x', 'utf8');

    await harness.start();
    await eventually(() => harness.events.some((e) => e.path === '/real.md'));
    await quietPeriod();

    const paths = harness.events.map((event) => event.path);
    expect(paths).toContain('/real.md');
    expect(paths.some((path) => path.startsWith('/.trash'))).toBe(false);
    expect(paths.some((path) => path.startsWith('/.vaultsyncforagents'))).toBe(false);
    expect(paths.some((path) => path.startsWith('/.obsidian'))).toBe(false);
    expect(paths.some((path) => path.includes('.tmp-'))).toBe(false);
    await harness.stop();
  });

  it('watches .obsidian content when sync is opted in, except volatile files', async () => {
    const harness = await makeHarness();
    await mkdir(join(harness.root, '.obsidian'), { recursive: true });
    await writeFile(join(harness.root, '.obsidian', 'app.json'), '{}', 'utf8');
    await writeFile(join(harness.root, '.obsidian', 'workspace.json'), '{}', 'utf8');
    await harness.start({ settings: { obsidianSync: true } });

    await eventually(() => harness.events.some((e) => e.path === '/.obsidian/app.json'));
    await quietPeriod();
    const paths = harness.events.map((event) => event.path);
    expect(paths).toContain('/.obsidian/app.json');
    expect(paths).not.toContain('/.obsidian/workspace.json');
    await harness.stop();
  });

  it('coalesces a burst into one batch, one event per path (last kind wins)', async () => {
    const harness = await makeHarness();
    await writeFile(join(harness.root, 'burst.md'), 'v1', 'utf8');
    await harness.start();
    await eventually(() => harness.events.some((e) => e.kind === 'add' && e.path === '/burst.md'));
    harness.events.length = 0;

    // Two files, one modified twice — all within the 120 ms window.
    await writeFile(join(harness.root, 'burst.md'), 'v2', 'utf8');
    await writeFile(join(harness.root, 'other.md'), 'v1', 'utf8');
    await writeFile(join(harness.root, 'burst.md'), 'v3', 'utf8');

    await eventually(() => harness.events.some((e) => e.path === '/other.md'));
    await quietPeriod();

    const burstEvents = harness.events.filter((e) => e.path === '/burst.md');
    expect(burstEvents).toEqual([{ kind: 'modify', path: '/burst.md' }]);
    expect(harness.events.filter((e) => e.path === '/other.md')).toEqual([
      { kind: 'add', path: '/other.md' },
    ]);
    await harness.stop();
  });
});
