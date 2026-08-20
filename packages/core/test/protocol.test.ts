import { describe, expect, it } from 'vitest';

import {
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
  type GetManifestMessage,
  type HelloAckMessage,
  type HelloMessage,
  type ManifestMessage,
  type Message,
  type PingMessage,
  type PongMessage,
  type ServerMessage,
} from '../src/index.js';

// Compile-time: every sample below must be assignable to the union it belongs
// to — the discriminated union is the contract.
const clientSamples: ClientMessage[] = [
  { type: 'hello', token: 'tok', protocolVersion: 1, cursor: 42 },
  { type: 'getManifest' },
  { type: 'getManifest', since: 7 },
  { type: 'commit', path: '/a.md', parentVersion: 'v1', hash: 'ab'.repeat(32), size: 3 },
  { type: 'commit', path: '/a.md', parentVersion: null, hash: 'ab'.repeat(32), size: 3, inline: 'aGVsbG8=' },
  { type: 'ping' },
  { type: 'ping', ts: 1234 },
];

const serverSamples: ServerMessage[] = [
  { type: 'helloAck', deviceId: 'd1', vaultName: 'personal', settings: { obsidianSync: false, displayName: 'personal' } },
  { type: 'manifest', entries: { '/a.md': { version: 'v1', hash: 'cd'.repeat(32), size: 10, deleted: false, mtime: 1 } } },
  { type: 'commitAck', version: 'v2', clock: { counter: 5, deviceId: 'd1' } },
  {
    type: 'conflict',
    winner: {
      id: 'v2', path: '/a.md', hash: 'ef'.repeat(32), size: 10, deviceId: 'd2',
      clock: { counter: 6, deviceId: 'd2' }, parentVersion: 'v1', ts: 123, kind: 'edit',
    },
    loserDisposition: 'conflictCopy',
  },
  { type: 'change', path: '/a.md', version: 'v2', hash: 'ef'.repeat(32), size: 10, deleted: false, device: 'd2' },
  { type: 'deviceSeen', deviceId: 'd2', ts: 456 },
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
  it('manifest maps path → entry', () => {
    const manifest: ManifestMessage = serverSamples[1] as ManifestMessage;
    const entry = manifest.entries['/a.md'];
    expect(entry).toBeDefined();
    expect(entry!.version).toBe('v1');
    expect(entry!.deleted).toBe(false);
  });

  it('change carries the fan-out payload', () => {
    const change: ChangeMessage = serverSamples[4] as ChangeMessage;
    expect(change.device).toBe('d2');
    expect(change.deleted).toBe(false);
  });

  it('commitAck carries version id + clock', () => {
    const ack: CommitAckMessage = serverSamples[2] as CommitAckMessage;
    expect(ack.version).toBe('v2');
    expect(ack.clock).toEqual({ counter: 5, deviceId: 'd1' });
  });

  it('conflict names the winning version and loser disposition', () => {
    const conflict: ConflictMessage = serverSamples[3] as ConflictMessage;
    expect(conflict.winner.clock.counter).toBe(6);
    expect(conflict.loserDisposition).toBe('conflictCopy');
  });

  it('hello/helloAck/commit/ping/pong/deviceSeen shapes hold', () => {
    const [hello, , , commit, , , pingTs] = clientSamples as [HelloMessage, GetManifestMessage, GetManifestMessage, CommitMessage, CommitMessage, PingMessage, PingMessage];
    expect(hello.protocolVersion).toBe(ProtocolVersion);
    expect(commit.parentVersion).toBe('v1');
    expect(pingTs.ts).toBe(1234);

    const [helloAck, , , , , deviceSeen, pong] = serverSamples as [HelloAckMessage, ManifestMessage, object, object, ChangeMessage, DeviceSeenMessage, PongMessage];
    expect(helloAck.settings.obsidianSync).toBe(false);
    expect(deviceSeen.deviceId).toBe('d2');
    expect(pong.ts).toBe(1234);
  });
});
