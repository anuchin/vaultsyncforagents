import { describe, expect, it } from 'vitest';

import {
  base64ToBytes,
  bytesToBase64,
  INLINE_CONTENT_MAX_BYTES,
  ProtocolError,
  ProtocolVersion,
  isClientMessage,
  isMessage,
  isServerMessage,
  parseMessage,
  type ChangeMessage,
  type ClientMessage,
  type CommitAckMessage,
  type CommitMessage,
  type ConflictMessage,
  type DeviceSeenMessage,
  type GetBlobMessage,
  type GetManifestMessage,
  type HelloAckMessage,
  type HelloMessage,
  type ManifestMessage,
  type Message,
  type PingMessage,
  type PongMessage,
  type PutBlobMessage,
  type ServerMessage,
} from '../src/index.js';

const clock = { counter: 5, deviceId: 'd1' } as const;

// Compile-time: every sample below must be assignable to the union it belongs
// to — the discriminated union is the contract.
const clientSamples: ClientMessage[] = [
  { type: 'hello', token: 'tok', protocolVersion: 1, cursor: 42 },
  { type: 'getManifest' },
  { type: 'getManifest', since: 7 },
  { type: 'commit', path: '/a.md', parentVersion: 'v1', hash: 'ab'.repeat(32), size: 3, kind: 'edit' },
  { type: 'commit', path: '/a.md', parentVersion: null, hash: 'ab'.repeat(32), size: 3, kind: 'edit', inline: 'aGVsbG8=' },
  {
    type: 'commit',
    path: '/b.md',
    parentVersion: 'v1',
    hash: 'cd'.repeat(32),
    size: 3,
    kind: 'rename',
    fromPath: '/a.md',
  },
  { type: 'commit', path: '/empty-dir', parentVersion: null, hash: '', size: 0, kind: 'edit', isFolder: true },
  { type: 'putBlob', hash: 'ef'.repeat(32), content: 'aGVsbG8=' },
  { type: 'getBlob', hash: 'ef'.repeat(32) },
  { type: 'ping' },
  { type: 'ping', ts: 1234 },
];

const serverSamples: ServerMessage[] = [
  { type: 'helloAck', deviceId: 'd1', vaultName: 'personal', settings: { obsidianSync: false, displayName: 'personal' } },
  {
    type: 'manifest',
    cursor: 9,
    entries: {
      '/a.md': { path: '/a.md', version: 'v1', hash: 'cd'.repeat(32), size: 10, deleted: false, clock, mtime: 1 },
      '/empty': { path: '/empty', version: 'v2', hash: '', size: 0, deleted: false, clock, isFolder: true, mtime: 2 },
    },
  },
  { type: 'commitAck', version: 'v2', clock: { counter: 5, deviceId: 'd1' }, seq: 7 },
  {
    type: 'conflict',
    winner: {
      id: 'v2', path: '/a.md', hash: 'ef'.repeat(32), size: 10, deviceId: 'd2',
      clock: { counter: 6, deviceId: 'd2' }, parentVersion: 'v1', ts: 123, kind: 'edit',
    },
    loserDisposition: 'conflictCopy',
    seq: 8,
  },
  {
    type: 'change',
    path: '/a.md',
    version: 'v2',
    hash: 'ef'.repeat(32),
    size: 10,
    deleted: false,
    device: 'd2',
    clock: { counter: 6, deviceId: 'd2' },
    kind: 'edit',
    seq: 3,
  },
  {
    type: 'change',
    path: '/b.md',
    version: 'v3',
    hash: 'ef'.repeat(32),
    size: 10,
    deleted: false,
    device: 'd2',
    clock: { counter: 7, deviceId: 'd2' },
    kind: 'rename',
    fromPath: '/a.md',
    seq: 4,
  },
  { type: 'deviceSeen', deviceId: 'd2', ts: 456 },
  { type: 'blobAck', hash: 'ef'.repeat(32) },
  { type: 'blob', hash: 'ef'.repeat(32), content: 'aGVsbG8=' },
  { type: 'error', code: 'UNAUTHORIZED', message: 'unknown token' },
  { type: 'pong', ts: 1234 },
];

describe('protocol constants', () => {
  it('pins the protocol version to 1', () => {
    expect(ProtocolVersion).toBe(1);
  });

  it('caps inline commit content at 256 KB', () => {
    expect(INLINE_CONTENT_MAX_BYTES).toBe(256 * 1024);
  });
});

describe('type guards', () => {
  it('accepts every well-formed client message', () => {
    for (const message of clientSamples) {
      expect(isMessage(message)).toBe(true);
      expect(isClientMessage(message)).toBe(true);
      expect(isServerMessage(message)).toBe(false);
    }
  });

  it('accepts every well-formed server message', () => {
    for (const message of serverSamples) {
      expect(isMessage(message)).toBe(true);
      expect(isServerMessage(message)).toBe(true);
      expect(isClientMessage(message)).toBe(false);
    }
  });

  it('rejects non-objects and unknown discriminants', () => {
    for (const bad of [null, undefined, 42, 'hello', {}, { type: 7 }, { type: 'nope' }, []]) {
      expect(isMessage(bad)).toBe(false);
      expect(isClientMessage(bad)).toBe(false);
      expect(isServerMessage(bad)).toBe(false);
    }
  });
});

describe('parseMessage', () => {
  it('parses a hello frame', () => {
    const parsed = parseMessage(JSON.stringify(clientSamples[0]));
    expect(parsed.type).toBe('hello');
    expect((parsed as HelloMessage).cursor).toBe(42);
  });

  it('parses every sample through the wire', () => {
    for (const message of [...clientSamples, ...serverSamples] as Message[]) {
      const parsed = parseMessage(JSON.stringify(message));
      expect(parsed.type).toBe(message.type);
      expect(parsed).toEqual(message);
    }
  });

  it('throws ProtocolError on invalid JSON', () => {
    expect(() => parseMessage('{not json')).toThrow(ProtocolError);
  });

  it('throws ProtocolError on unknown message types', () => {
    expect(() => parseMessage('{"type":"celebrate"}')).toThrow(ProtocolError);
    expect(() => parseMessage('"hello"')).toThrow(ProtocolError);
    expect(() => parseMessage('null')).toThrow(ProtocolError);
  });
});

describe('message field shapes (compile-time + spot runtime checks)', () => {
  it('manifest maps path → entry with path, clock, and isFolder', () => {
    const manifest = serverSamples[1] as ManifestMessage;
    const entry = manifest.entries['/a.md'];
    expect(entry).toBeDefined();
    expect(entry!.path).toBe('/a.md');
    expect(entry!.version).toBe('v1');
    expect(entry!.deleted).toBe(false);
    expect(entry!.clock).toEqual(clock);
    expect(entry!.isFolder).toBeUndefined();
    const folder = manifest.entries['/empty'];
    expect(folder!.isFolder).toBe(true);
    expect(manifest.cursor).toBe(9);
  });

  it('change carries the fan-out payload plus clock, kind, and seq', () => {
    const change: ChangeMessage = serverSamples[4] as ChangeMessage;
    expect(change.device).toBe('d2');
    expect(change.deleted).toBe(false);
    expect(change.clock).toEqual({ counter: 6, deviceId: 'd2' });
    expect(change.kind).toBe('edit');
    expect(change.seq).toBe(3);
    const rename: ChangeMessage = serverSamples[5] as ChangeMessage;
    expect(rename.kind).toBe('rename');
    expect(rename.fromPath).toBe('/a.md');
  });

  it('commitAck carries version id + clock', () => {
    const ack: CommitAckMessage = serverSamples[2] as CommitAckMessage;
    expect(ack.version).toBe('v2');
    expect(ack.clock).toEqual({ counter: 5, deviceId: 'd1' });
    expect(ack.seq).toBe(7);
  });

  it('conflict names the winning version and loser disposition', () => {
    const conflict: ConflictMessage = serverSamples[3] as ConflictMessage;
    expect(conflict.winner.clock.counter).toBe(6);
    expect(conflict.loserDisposition).toBe('conflictCopy');
  });

  it('hello/helloAck/commit/blob/ping/pong/deviceSeen/error shapes hold', () => {
    const [hello, , , , , renameCommit, folderCommit, putBlob, getBlob, , pingTs] =
      clientSamples as [
        HelloMessage,
        GetManifestMessage,
        GetManifestMessage,
        CommitMessage,
        CommitMessage,
        CommitMessage,
        CommitMessage,
        PutBlobMessage,
        GetBlobMessage,
        PingMessage,
        PingMessage,
      ];
    expect(hello.protocolVersion).toBe(ProtocolVersion);
    expect(renameCommit.kind).toBe('rename');
    expect(renameCommit.fromPath).toBe('/a.md');
    expect(folderCommit.isFolder).toBe(true);
    expect(putBlob.content).toBe('aGVsbG8=');
    expect(getBlob.hash).toBe('ef'.repeat(32));
    expect(pingTs.ts).toBe(1234);

    const [helloAck, , , , , , deviceSeen, , , , pong] = serverSamples as [
      HelloAckMessage,
      ManifestMessage,
      object,
      object,
      ChangeMessage,
      ChangeMessage,
      DeviceSeenMessage,
      object,
      object,
      object,
      PongMessage,
    ];
    expect(helloAck.settings.obsidianSync).toBe(false);
    expect(deviceSeen.deviceId).toBe('d2');
    expect(pong.ts).toBe(1234);
  });
});

describe('base64 wire encoding', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array(1024).map((_, i) => (i * 7 + 13) & 0xff);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it('round-trips the empty payload', () => {
    expect(base64ToBytes(bytesToBase64(new Uint8Array(0)))).toEqual(new Uint8Array(0));
  });

  it('rejects invalid base64 with ProtocolError', () => {
    expect(() => base64ToBytes('not valid base64!!!')).toThrow(ProtocolError);
  });
});
