/**
 * Server-side commit arbitration (ARCHITECTURE.md §4) — the single source of
 * truth that the real Cloudflare Durable Object will import.
 *
 * This module is deliberately storage-agnostic and 100% pure TypeScript
 * (Maps in, Maps out, no I/O, no timers, no Node APIs): the DO wraps it with
 * SQLite persistence, the in-memory test server wraps it with a `Map` — both
 * run the *same* arbitration, byte for byte.
 *
 * Rules (mirroring the client's `resolve.ts` so both sides provably agree):
 *
 *  1. `parentVersion` is the current head → **fast-path apply**. The new head
 *     gets clock `{parent counter + 1, committing device}`.
 *  2. Stale parent (a concurrent edit happened) → **conflict**, arbitrated by
 *     `compareClocks(remote head clock, incoming tentative = parent+1 on the
 *     committing device)`. The tentative clock is exactly what the client's
 *     `computeSyncPlan` predicted for the same parent, so client prediction
 *     and server arbitration coincide by construction.
 *  3. The loser's content is *never deleted*: a **conflict-copy file** is
 *     synthesized as a normal version (`conflictnames.ts`, LOSING device's
 *     name), building on the winner so it cannot re-conflict. No copy is
 *     synthesized when the loser has no content to preserve: deletions,
 *     folder placeholders, byte-identical content, and content unchanged
 *     since the common ancestor (a no-op edit losing a race).
 *  4. Renames are chain migrations: the entry moves `fromPath → path` as one
 *     version of kind `'rename'`; history follows the file.
 *
 * Version ids are deterministic given the state (`v{versions.size + 1}`) so
 * simulations are reproducible; the real DO may substitute its own id scheme.
 */

import { compareClocks, nextClock } from '../clock.js';
import { conflictCopyPath } from '../conflictnames.js';
import { ProtocolError } from '../errors.js';
import { foldKeyForPath, isNFCPath } from '../paths.js';
import type { ChangePayload, ConflictWinner } from '../protocol.js';
import type { LogicalClock, Version, VersionKind } from '../types.js';

// --- path safety (§14) ---------------------------------------------------------

/**
 * The admission rule that keeps two active entries from ever sharing a fold
 * key — v1's collisionKey, now enforced server-side (ARCHITECTURE §14).
 * Both servers (this module's wrappers: the DO room, the in-memory test
 * server) consult it before arbitration, so a non-conforming client cannot
 * fork the vault into case/canonical twins no matter which backend it hits:
 *
 *   - paths must be in NFC canonical form (PROTOCOL — the worker's shape
 *     gate rejects non-canonical paths identically; named here so the
 *     in-memory server enforces parity);
 *   - a commit that would create a NEW live path (no row, or only a
 *     tombstone) must not fold (`foldKeyForPath`: NFC + case-fold) to any
 *     OTHER live entry (PATH_COLLIDES). Edits to an existing head flow
 *     unchanged, so legacy pairs already admitted before the rule stay
 *     syncable — the gate stops NEW colliders from forming, it does not
 *     retroactively punish old ones. A case-only rename is exempt by
 *     construction: the source row folds to the destination's key and is
 *     skipped (`fromPath`).
 */
export function pathSafetyViolation(
  files: ReadonlyMap<string, ArbitrationFileState>,
  commit: { path: string; fromPath?: string },
): { code: 'PROTOCOL' | 'PATH_COLLIDES'; message: string } | null {
  if (!isNFCPath(commit.path)) {
    return {
      code: 'PROTOCOL',
      message: `commit path must be NFC canonical form, got ${previewForViolation(commit.path)}`,
    };
  }
  if (commit.fromPath !== undefined && !isNFCPath(commit.fromPath)) {
    return {
      code: 'PROTOCOL',
      message: `commit fromPath must be NFC canonical form, got ${previewForViolation(commit.fromPath)}`,
    };
  }
  const existing = files.get(commit.path);
  const createsNewLivePath = existing === undefined || existing.deleted;
  if (!createsNewLivePath) return null;
  const key = foldKeyForPath(commit.path);
  for (const [path, row] of files) {
    if (row.deleted) continue;
    if (path === commit.path || path === commit.fromPath) continue;
    if (foldKeyForPath(path) === key) {
      return {
        code: 'PATH_COLLIDES',
        message:
          `path ${previewForViolation(commit.path)} collides with live path ${previewForViolation(path)} ` +
          `under the case/canonical fold — rename one of them`,
      };
    }
  }
  return null;
}

/** Short, log-safe path rendering for violation messages. */
function previewForViolation(path: string): string {
  return JSON.stringify(path.length > 80 ? `${path.slice(0, 77)}…` : path);
}

// --- state --------------------------------------------------------------------

/** One path's authoritative state (the DO's `files` row). */
export interface ArbitrationFileState {
  currentVersion: string;
  head: Version;
  deleted: boolean;
  /** Folder placeholder (FR-10): hash `''`, size 0, no content to preserve. */
  isFolder?: boolean;
}

/**
 * The whole arbitration state (the DO's `files` + `versions` tables, in
 * memory). Treated as immutable: `arbitrateCommit` returns a fresh state.
 */
export interface ArbitrationState {
  files: Map<string, ArbitrationFileState>;
  versions: Map<string, Version>;
}

export function emptyArbitrationState(): ArbitrationState {
  return { files: new Map(), versions: new Map() };
}

/** A commit awaiting arbitration (the payload of a protocol `commit`). */
export interface ArbitrationCommit {
  path: string;
  /** Version id the commit builds on; `null` = brand-new chain. */
  parentVersion: string | null;
  hash: string;
  size: number;
  kind: VersionKind;
  /** Required for `kind: 'rename'`. */
  fromPath?: string;
  isFolder?: boolean;
}

/**
 * What happened to the losing side. One value today; the field exists so the
 * protocol (and the DO's persistence of it) can grow dispositions without a
 * breaking change.
 */
export type LoserDisposition = 'conflictCopy';

export interface ArbitrationOutcome {
  result: 'applied' | 'conflict';
  /**
   * The winning version (newly created, or the standing head), with the
   * head's folder flag folded in (`isFolder`). `conflict` replies carry the
   * winner to the LOSING client verbatim; without the flag a folder
   * placeholder winner (hash `''`) would be materialized as a content pull
   * for an empty hash — the blob-fetch guard refuses that, wedging the
   * client's cycle. The flag is metadata routing, not new authority.
   */
  winner: ConflictWinner;
  loserDisposition: LoserDisposition;
  /** Id of the winning version — what a `commitAck` would echo. */
  newVersionId: string;
  /** Clock of the winning head. */
  clock: LogicalClock;
  /** Fan-out payload for the winning head (send to all *other* clients). */
  broadcast: ChangePayload;
  /** Fan-out for the synthesized conflict copy, when one was made (send to all, including the committer). */
  conflictCopy?: ChangePayload;
  conflictCopyPath?: string;
}

export interface ArbitrationVerdict {
  outcome: ArbitrationOutcome;
  /** The next state — the input state is never mutated. */
  state: ArbitrationState;
}

/**
 * Arbitrate one commit. Pure and deterministic.
 *
 * `devices` maps device id → human name and is only consulted for
 * conflict-copy naming; absent entries fall back to the raw device id.
 */
export function arbitrateCommit(
  state: ArbitrationState,
  commit: ArbitrationCommit,
  deviceId: string,
  now: number,
  devices: ReadonlyMap<string, string> = new Map(),
): ArbitrationVerdict {
  const files = new Map(state.files);
  const versions = new Map(state.versions);
  const mintId = (): string => `v${versions.size + 1}`;

  const parent =
    commit.parentVersion !== null ? versions.get(commit.parentVersion) : undefined;
  if (commit.parentVersion !== null && parent === undefined) {
    throw new ProtocolError(
      `commit for ${JSON.stringify(commit.path)} names unknown parent version ` +
        JSON.stringify(commit.parentVersion),
    );
  }

  const target = files.get(commit.path);

  // --- renames: chain migration (FR-9) --------------------------------------
  if (commit.kind === 'rename') {
    const fromPath = commit.fromPath;
    if (fromPath === undefined) {
      throw new ProtocolError('rename commit requires fromPath');
    }
    const source = files.get(fromPath);

    /** Move the chain `fromPath → commit.path` as one rename version. */
    const applyMigration = (): ArbitrationVerdict => {
      const id = mintId();
      const clock = nextClock(source!.head.clock, deviceId);
      const version: Version = {
        id,
        path: commit.path,
        hash: commit.hash,
        size: commit.size,
        deviceId,
        clock,
        parentVersion: commit.parentVersion,
        ts: now,
        kind: 'rename',
      };
      versions.set(id, version);
      files.delete(source!.head.path);
      files.set(commit.path, {
        currentVersion: id,
        head: version,
        deleted: false,
        ...(commit.isFolder ? { isFolder: true } : {}),
      });
      return {
        outcome: {
          result: 'applied',
          winner: { ...version, ...(commit.isFolder === true ? { isFolder: true } : {}) },
          loserDisposition: 'conflictCopy',
          newVersionId: id,
          clock,
          broadcast: payloadOf(version, {
            fromPath: source!.head.path,
            isFolder: commit.isFolder === true,
          }),
        },
        state: { files, versions },
      };
    };

    if (source !== undefined && source.head.id === commit.parentVersion) {
      // Fast path at the source: the mover built on the current head.
      const occupant = files.get(commit.path);
      if (occupant === undefined) {
        return applyMigration();
      }
      // Destination occupied: arbitrate the move against the occupant.
      const tentative = nextClock(source.head.clock, deviceId);
      if (compareClocks(tentative, occupant.head.clock) > 0) {
        const verdict = applyMigration();
        // The move raced the occupant and won — that is a conflict outcome.
        const outcome: ArbitrationOutcome = { ...verdict.outcome, result: 'conflict' };
        const copy = preserveLoser(
          { hash: occupant.head.hash, size: occupant.head.size, deleted: occupant.deleted, isFolder: occupant.isFolder, deviceId: occupant.head.deviceId },
          { parentId: verdict.outcome.winner.id, baseClock: tentative, winnerHash: commit.hash, ancestorHash: parent?.hash },
          files,
          versions,
          mintId,
          now,
          devices,
          commit.path,
        );
        return withCopy({ outcome, state: verdict.state }, copy);
      }
      // The rename lost: the content is safe at `fromPath` — no copy needed.
      return loseToHead(commit, deviceId, parent?.hash, occupant, files, versions, mintId, now, devices, { suppressCopy: true });
    }
    // Source unknown or stale: the chain already moved on elsewhere. Fall
    // through to the generic path logic at `path` — content is preserved
    // wherever the arbitration lands it (documented v1 corner).
  }

  // --- fast path --------------------------------------------------------------
  if (target === undefined || target.head.id === commit.parentVersion) {
    const baseClock = target !== undefined ? target.head.clock : parent?.clock;
    const id = mintId();
    const clock = nextClock(baseClock, deviceId);
    const version: Version = {
      id,
      path: commit.path,
      hash: commit.hash,
      size: commit.size,
      deviceId,
      clock,
      parentVersion: commit.parentVersion,
      ts: now,
      kind: commit.kind,
    };
    versions.set(id, version);
    files.set(commit.path, {
      currentVersion: id,
      head: version,
      deleted: commit.kind === 'delete',
      isFolder: commit.isFolder === true,
    });
    return {
      outcome: {
        result: 'applied',
        winner: { ...version, ...(commit.isFolder === true ? { isFolder: true } : {}) },
        loserDisposition: 'conflictCopy',
        newVersionId: id,
        clock,
        broadcast: payloadOf(version, { isFolder: commit.isFolder === true }),
      },
      state: { files, versions },
    };
  }

  // --- conflict: stale parent vs standing head --------------------------------
  const tentative = nextClock(parent?.clock, deviceId);
  const incomingWins = compareClocks(tentative, target.head.clock) > 0;

  if (incomingWins) {
    // The incoming commit displaces the standing head; preserve the loser.
    const id = mintId();
    const version: Version = {
      id,
      path: commit.path,
      hash: commit.hash,
      size: commit.size,
      deviceId,
      clock: tentative,
      parentVersion: commit.parentVersion,
      ts: now,
      kind: commit.kind,
    };
    versions.set(id, version);
    files.set(commit.path, {
      currentVersion: id,
      head: version,
      deleted: commit.kind === 'delete',
      isFolder: commit.isFolder === true,
    });
    if (commit.kind === 'rename' && commit.fromPath !== undefined && files.has(commit.fromPath)) {
      files.delete(commit.fromPath);
    }
    const outcome: ArbitrationOutcome = {
      result: 'conflict',
      winner: { ...version, ...(commit.isFolder === true ? { isFolder: true } : {}) },
      loserDisposition: 'conflictCopy',
      newVersionId: id,
      clock: tentative,
      broadcast: payloadOf(version, { isFolder: commit.isFolder === true, fromPath: commit.fromPath }),
    };
    const copy = preserveLoser(
      { hash: target.head.hash, size: target.head.size, deleted: target.deleted, isFolder: target.isFolder, deviceId: target.head.deviceId },
      { parentId: id, baseClock: tentative, winnerHash: commit.hash, ancestorHash: parent?.hash },
      files,
      versions,
      mintId,
      now,
      devices,
      commit.path,
    );
    return withCopy({ outcome, state: { files, versions } }, copy);
  }

  return loseToHead(commit, deviceId, parent?.hash, target, files, versions, mintId, now, devices);
}

// --- module helpers ------------------------------------------------------------

/** Shape of a losing side, unified across "old head" and "incoming commit". */
interface LoserSide {
  hash: string;
  size: number;
  deleted: boolean;
  isFolder?: boolean;
  deviceId: string;
}

interface PreservationContext {
  parentId: string;
  baseClock: LogicalClock;
  winnerHash: string;
  ancestorHash: string | undefined;
}

/**
 * Whether the loser's content must be preserved as a conflict copy.
 *
 * No copy when: the loser is a deletion (nothing to preserve), a folder
 * placeholder, byte-identical to the winner (identical outcome), or unchanged
 * since the common ancestor (a no-op edit losing a race — that exact content
 * is already in history and the winner's side saw no real change).
 */
function needsCopy(loser: LoserSide, context: PreservationContext): boolean {
  if (loser.deleted) return false;
  if (loser.isFolder === true || loser.hash === '') return false;
  if (loser.hash === context.winnerHash) return false;
  if (context.ancestorHash !== undefined && loser.hash === context.ancestorHash) return false;
  return true;
}

function preserveLoser(
  loser: LoserSide,
  context: PreservationContext,
  files: Map<string, ArbitrationFileState>,
  versions: Map<string, Version>,
  mintId: () => string,
  now: number,
  devices: ReadonlyMap<string, string>,
  originalPath: string,
): ChangePayload | undefined {
  if (!needsCopy(loser, context)) return undefined;
  const name = devices.get(loser.deviceId) ?? loser.deviceId;
  const copyPath = conflictCopyPath(originalPath, name, now, (candidate) => files.has(candidate));
  const id = mintId();
  const clock = nextClock(context.baseClock, loser.deviceId);
  const version: Version = {
    id,
    path: copyPath,
    hash: loser.hash,
    size: loser.size,
    deviceId: loser.deviceId,
    clock,
    parentVersion: context.parentId,
    ts: now,
    kind: 'conflictCopy',
  };
  versions.set(id, version);
  files.set(copyPath, { currentVersion: id, head: version, deleted: false });
  return payloadOf(version);
}

/** The incoming commit lost: the standing head wins. */
function loseToHead(
  commit: ArbitrationCommit,
  deviceId: string,
  ancestorHash: string | undefined,
  target: ArbitrationFileState,
  files: Map<string, ArbitrationFileState>,
  versions: Map<string, Version>,
  mintId: () => string,
  now: number,
  devices: ReadonlyMap<string, string>,
  options: { suppressCopy?: boolean } = {},
): ArbitrationVerdict {
  const head = target.head;
  const outcome: ArbitrationOutcome = {
    result: 'conflict',
    // The standing head wins — fold its folder flag into the wire winner like
    // every other outcome branch (a placeholder winner must materialize as
    // folder metadata on the losing client, never as a content pull).
    winner: { ...head, ...(target.isFolder === true ? { isFolder: true } : {}) },
    loserDisposition: 'conflictCopy',
    newVersionId: head.id,
    clock: head.clock,
    broadcast: payloadOf(head, { isFolder: target.isFolder === true }),
  };
  const verdict: ArbitrationVerdict = { outcome, state: { files, versions } };
  if (options.suppressCopy) return verdict;
  const copy = preserveLoser(
    { hash: commit.hash, size: commit.size, deleted: commit.kind === 'delete', isFolder: commit.isFolder, deviceId },
    { parentId: head.id, baseClock: head.clock, winnerHash: head.hash, ancestorHash },
    files,
    versions,
    mintId,
    now,
    devices,
    commit.path,
  );
  return withCopy(verdict, copy);
}

function withCopy(verdict: ArbitrationVerdict, copy: ChangePayload | undefined): ArbitrationVerdict {
  if (copy === undefined) return verdict;
  return {
    outcome: { ...verdict.outcome, conflictCopy: copy, conflictCopyPath: copy.path },
    state: verdict.state,
  };
}

function payloadOf(
  version: Version,
  extra: { isFolder?: boolean; fromPath?: string } = {},
): ChangePayload {
  return {
    path: version.path,
    version: version.id,
    hash: version.hash,
    size: version.size,
    deleted: version.kind === 'delete',
    device: version.deviceId,
    clock: version.clock,
    kind: version.kind,
    ...(extra.isFolder === true ? { isFolder: true } : {}),
    ...(extra.fromPath !== undefined ? { fromPath: extra.fromPath } : {}),
  };
}
