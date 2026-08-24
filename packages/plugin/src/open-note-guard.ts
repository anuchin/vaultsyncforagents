/**
 * Open-note pull guard — the editor race, v1's single hardest bug class.
 *
 * The shape: a remote change fans out for a note that is OPEN with UNSAVED
 * edits. Obsidian autosaves continuously, so the disk copy usually carries
 * the user's work — but between the last keystroke and the ~2 s autosave the
 * buffer leads the disk. When the pull overwrites the file in that window,
 * Obsidian does NOT refresh a dirty editor (external-edit refresh covers
 * clean buffers only), and the next autosave writes the stale buffer back
 * over the remote content. Core's divergence guard compares DISK against the
 * index, so it cannot see unsaved-buffer edits; this guard closes the window
 * from the plugin side, the only place editor state exists.
 *
 * Rule: when core is about to overwrite a vault path (a pull's `writeFile`)
 * and the note is open in an editor we cannot prove CLEAN, the write is
 * redirected to a conflict copy (`Note (conflict … - from Device).md`,
 * core's `conflictCopyPath`). The bookkeeping then converges honestly:
 * core records the pulled head for the original path; the user's untouched
 * content on disk scans as a local edit on top of it next cycle (what the
 * user's screen already shows wins the head), and the redirected copy —
 * holding the remote version — uploads as a new file and fans out to every
 * device. Nothing is silently lost in either direction, and the divergence
 * is VISIBLE in the vault instead of hidden in a cache.
 *
 * "Cannot prove clean" covers three cases: an `editor-change` event inside
 * the dirty window (autosave may not have landed yet), a text buffer that
 * differs from the disk content (line-ending-normalized), and being unable
 * to ask the view at all (editor-less views are treated as clean — media
 * viewers do not write back).
 */

import { conflictCopyPath } from '@vsa/core';

/** Minimal leaf shape — the real `WorkspaceLeaf` satisfies it structurally. */
export interface LeafLike {
  view: {
    file?: { path: string } | null;
    editor?: { getValue(): string };
  };
}

/** The workspace surface the guard subscribes to (structural, mock-friendly). */
export interface WorkspaceLike {
  iterateAllLeaves(callback: (leaf: LeafLike) => void): void;
  on(
    name: 'editor-change',
    callback: (editor: unknown, info: { file?: { path: string } | null }) => void,
  ): unknown;
  offref(ref: unknown): void;
}

export interface OpenNoteGuardOptions {
  workspace: WorkspaceLike;
  /** This device's display name (conflict-copy naming convention). */
  deviceName: () => string;
  /** On-disk text at an ADAPTER path; null when missing or unreadable. */
  readText: (adapterPath: string) => Promise<string | null>;
  /** Existence check (ADAPTER path) for conflict-name collision avoidance. */
  existsNow?: (adapterPath: string) => boolean;
  now: () => number;
  /** Edit events newer than this (ms) flag the buffer dirty. Default 2500. */
  dirtyWindowMs?: number;
  /** Fired every time a pull is redirected (plugin shows a Notice). */
  onRedirect?: (redirect: { fromPath: string; toPath: string }) => void;
}

const DEFAULT_DIRTY_WINDOW_MS = 2500;

export class OpenNoteGuard {
  private readonly workspace: WorkspaceLike;
  private readonly options: OpenNoteGuardOptions;
  private readonly dirtyWindowMs: number;
  private readonly lastEditAt = new Map<string, number>();
  private refs: unknown[] = [];

  constructor(options: OpenNoteGuardOptions) {
    this.options = options;
    this.workspace = options.workspace;
    this.dirtyWindowMs = options.dirtyWindowMs ?? DEFAULT_DIRTY_WINDOW_MS;
  }

  /** Subscribe to editor activity (idempotent). */
  start(): void {
    if (this.refs.length > 0) return;
    this.refs.push(
      this.workspace.on('editor-change', (_editor, info) => {
        const file = info?.file;
        if (file != null) this.lastEditAt.set(file.path, this.options.now());
      }),
    );
  }

  stop(): void {
    for (const ref of this.refs) this.workspace.offref(ref);
    this.refs = [];
  }

  /**
   * `ObsidianStorageAdapter.openNoteRedirect` implementation: given the vault
   * path core is about to overwrite, return the conflict-copy path to write
   * to instead — or null when the write may proceed normally.
   */
  async conflictRedirectFor(vaultPath: string): Promise<string | null> {
    if (!vaultPath.startsWith('/')) return null;
    const adapterPath = vaultPath.slice(1);
    // Sync-internal writes (the state file, temp files) are never user notes.
    if (adapterPath.startsWith('.vaultsyncforagents/')) return null;

    const openView = this.findOpenView(adapterPath);
    if (openView === null) return null;

    // A recent edit means autosave may not have landed: buffer leads disk.
    const lastEdit = this.lastEditAt.get(adapterPath);
    if (lastEdit !== undefined && this.options.now() - lastEdit < this.dirtyWindowMs) {
      return this.redirect(vaultPath);
    }

    const editor = openView.view.editor;
    if (editor === undefined) return null; // view without a save-capable editor — clean
    const disk = await this.options.readText(adapterPath);
    if (disk === null) return null; // nothing on disk to fight over — pull recreates
    if (normalizeText(disk) !== normalizeText(editor.getValue())) {
      return this.redirect(vaultPath);
    }
    return null;
  }

  /** The first leaf currently displaying `adapterPath`, when any. */
  private findOpenView(adapterPath: string): LeafLike | null {
    let found: LeafLike | null = null;
    this.workspace.iterateAllLeaves((leaf) => {
      if (found === null && leaf.view.file?.path === adapterPath) found = leaf;
    });
    return found;
  }

  private redirect(vaultPath: string): string {
    const exists = (candidate: string): boolean =>
      this.options.existsNow?.(candidate.slice(1)) ?? false;
    const toPath = conflictCopyPath(vaultPath, this.options.deviceName(), this.options.now(), exists);
    this.options.onRedirect?.({ fromPath: vaultPath, toPath });
    return toPath;
  }
}

/** Line-ending-insensitive comparison (Windows disks carry CRLF; CM keeps LF). */
function normalizeText(text: string): string {
  return text.replace(/\r\n/g, '\n');
}
