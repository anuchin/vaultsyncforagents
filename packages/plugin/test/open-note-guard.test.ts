import { describe, expect, it } from 'vitest';
import { OpenNoteGuard, type LeafLike, type WorkspaceLike } from '../src/open-note-guard.js';

/** Tiny structural workspace: registered leaves + an editor-change emitter. */
class FakeWorkspace implements WorkspaceLike {
  readonly leaves: LeafLike[] = [];
  private listeners: Array<(editor: unknown, info: { file?: { path: string } | null }) => void> = [];

  iterateAllLeaves(cb: (leaf: LeafLike) => void): void {
    for (const leaf of this.leaves) cb(leaf);
  }
  on(
    name: 'editor-change',
    cb: (editor: unknown, info: { file?: { path: string } | null }) => void,
  ): unknown {
    this.listeners.push(cb);
    return cb;
  }
  offref(ref: unknown): void {
    this.listeners = this.listeners.filter((l) => l !== ref);
  }
  /** Simulate Obsidian's editor-change for the note at `path`. */
  emitEdit(path: string): void {
    for (const l of this.listeners) l(null, { file: { path } });
  }
}

interface Rig {
  guard: OpenNoteGuard;
  workspace: FakeWorkspace;
  redirects: Array<{ fromPath: string; toPath: string }>;
  disks: Map<string, string>;
  existing: Set<string>;
  nowRef: { t: number };
}

function rig(): Rig {
  const workspace = new FakeWorkspace();
  const disks = new Map<string, string>();
  const existing = new Set<string>();
  const redirects: Array<{ fromPath: string; toPath: string }> = [];
  const nowRef = { t: 1_772_000_000_000 };
  const guard = new OpenNoteGuard({
    workspace,
    deviceName: () => 'Laptop',
    readText: async (p) => disks.get(p) ?? null,
    existsNow: (p) => existing.has(p),
    now: () => nowRef.t,
    dirtyWindowMs: 2500,
    onRedirect: (r) => redirects.push(r),
  });
  guard.start();
  return { guard, workspace, redirects, disks, existing, nowRef };
}

/** Open `path` in a text-editor view whose buffer reads `bufferContent`. */
function openNote(workspace: FakeWorkspace, path: string, bufferContent: string): void {
  workspace.leaves.push({ view: { file: { path }, editor: { getValue: () => bufferContent } } });
}

describe('OpenNoteGuard', () => {
  it('lets the pull proceed when the note is not open anywhere', async () => {
    const r = rig();
    expect(await r.guard.conflictRedirectFor('/notes/a.md')).toBeNull();
    expect(r.redirects).toEqual([]);
  });

  it('lets the pull proceed for a CLEAN open note (buffer === disk)', async () => {
    const r = rig();
    openNote(r.workspace, 'notes/a.md', 'line one\nline two\n');
    r.disks.set('notes/a.md', 'line one\nline two\n');
    expect(await r.guard.conflictRedirectFor('/notes/a.md')).toBeNull();
  });

  it('normalizes CRLF before comparing (a Windows disk is not automatically dirty)', async () => {
    const r = rig();
    openNote(r.workspace, 'notes/a.md', 'one\ntwo\n');
    r.disks.set('notes/a.md', 'one\r\ntwo\r\n');
    expect(await r.guard.conflictRedirectFor('/notes/a.md')).toBeNull();
  });

  it('redirects when the buffer diverges from disk (unsaved work a hash check cannot see)', async () => {
    const r = rig();
    openNote(r.workspace, 'notes/a.md', 'one\nTYPED BUT UNSAVED\n');
    r.disks.set('notes/a.md', 'one\n');
    const target = await r.guard.conflictRedirectFor('/notes/a.md');
    expect(target).toMatch(/^\/notes\/a \(conflict .* - from Laptop\)\.md$/);
    expect(r.redirects).toHaveLength(1);
  });

  it('redirects during the dirty window after an editor-change, even when buffer === disk', async () => {
    const r = rig();
    openNote(r.workspace, 'notes/a.md', 'one\n');
    r.disks.set('notes/a.md', 'one\n');
    r.workspace.emitEdit('notes/a.md'); // keystroke landed in the buffer NOW
    expect(await r.guard.conflictRedirectFor('/notes/a.md')).toMatch(/conflict/);
  });

  it('stops redirecting once the dirty window has passed (autosave caught up)', async () => {
    const r = rig();
    openNote(r.workspace, 'notes/a.md', 'one\n');
    r.disks.set('notes/a.md', 'one\n');
    r.workspace.emitEdit('notes/a.md');
    r.nowRef.t += 10_000; // long past the window, disk == buffer
    expect(await r.guard.conflictRedirectFor('/notes/a.md')).toBeNull();
  });

  it('ignores editor-less views (media viewers do not write back)', async () => {
    const r = rig();
    r.workspace.leaves.push({ view: { file: { path: 'img.png' } } });
    expect(await r.guard.conflictRedirectFor('/img.png')).toBeNull();
  });

  it('never redirects sync-internal writes, even if a state file were somehow open', async () => {
    const r = rig();
    openNote(r.workspace, '.vaultsyncforagents/state', '{}');
    expect(await r.guard.conflictRedirectFor('/.vaultsyncforagents/state')).toBeNull();
  });

  it('de-conflicts the copy name when the first candidate already exists', async () => {
    const r = rig();
    openNote(r.workspace, 'notes/a.md', 'dirty buffer');
    r.disks.set('notes/a.md', 'clean disk');
    // Pre-occupy the deterministic_first candidate for this exact timestamp.
    const first = await r.guard.conflictRedirectFor('/notes/a.md');
    r.existing.add(first!.slice(1));
    const second = await r.guard.conflictRedirectFor('/notes/a.md');
    expect(second).not.toBe(first);
    expect(second).toMatch(/ 2\.md$/);
  });

  it('stop() unsubscribes (no dirty-window state after unload)', async () => {
    const r = rig();
    openNote(r.workspace, 'notes/a.md', 'one\n');
    r.disks.set('notes/a.md', 'one\n');
    r.guard.stop();
    r.workspace.emitEdit('notes/a.md');
    expect(await r.guard.conflictRedirectFor('/notes/a.md')).toBeNull();
  });
});
