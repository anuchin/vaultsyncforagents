import { describe, expect, it } from 'vitest';

import { InMemorySyncServer, sha256Hex, type Message } from '../src/index.js';

const NOW0 = 1_000_000;
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

/**
 * Yield the event loop until `cond` holds. Awaiting a real crypto digest
 * gives the server's own async handlers (which await the same primitive)
 * room to settle — no timers anywhere.
 */
async function until(cond: () => boolean, spins = 50): Promise<void> {
  for (let i = 0; i < spins && !cond(); i++) {
    await sha256Hex('');
  }
  expect(cond(), 'condition never became true').toBe(true);
}

/** Collect everything a transport receives; the test pulls messages out. */
class Mailbox {
  readonly received: Message[] = [];
  closed?: string;

  attach(transport: {
    onMessage(cb: (m: Message) => void): void;
    onClose(cb: (r: { reason?: string }) => void): void;
  }): void {
    transport.onMessage((m) => this.received.push(m));
    transport.onClose((r) => {
      this.closed = r.reason;
    });
  }
  of<T extends Message['type']>(type: T): Extract<Message, { type: T }>[] {
    return this.received.filter((m) => m.type === type) as Extract<Message, { type: T }>[];
  }
}

function rig(): { server: InMemorySyncServer; mailbox: Mailbox; send: (m: Message) => void } {
  let t = NOW0;
  const server = new InMemorySyncServer({ now: () => ++t, vaultName: 'v' });
  server.register('dev-a', 'Alpha');
  const pair = server.connectPair('tok-dev-a');
  const mailbox = new Mailbox();
  mailbox.attach(pair.client);
  return { server, mailbox, send: (m) => pair.client.send(m) };
}

describe('InMemorySyncServer — hello/auth', () => {
  it('authenticates a registered token and replies helloAck', () => {
    const { mailbox, send } = rig();
    send({ type: 'hello', token: 'tok-dev-a', protocolVersion: 1, cursor: 0 });
    const ack = mailbox.of('helloAck');
    expect(ack).toHaveLength(1);
    expect(ack[0]!.deviceId).toBe('dev-a');
    expect(ack[0]!.vaultName).toBe('v');
  });

  it('rejects an unknown token with an error and closes the connection', () => {
    const { mailbox, send } = rig();
    send({ type: 'hello', token: 'tok-imposter', protocolVersion: 1, cursor: 0 });
    expect(mailbox.of('error')[0]?.code).toBe('UNAUTHORIZED');
    expect(mailbox.of('helloAck')).toHaveLength(0);
    expect(mailbox.closed).toBe('UNAUTHORIZED');
  });

  it('rejects a revoked device with REVOKED', () => {
    let t = NOW0;
    const server = new InMemorySyncServer({ now: () => ++t });
    server.register('dev-a', 'Alpha');
    server.revoke('dev-a');
    const pair = server.connectPair('tok-dev-a');
    const received: Message[] = [];
    pair.client.onMessage((m) => received.push(m));
    pair.client.send({ type: 'hello', token: 'tok-dev-a', protocolVersion: 1, cursor: 0 });
    expect(received.find((m) => m.type === 'error')).toMatchObject({ code: 'REVOKED' });
  });

  it('refuses pre-hello messages', () => {
    const { mailbox, send } = rig();
    send({ type: 'getManifest' });
    expect(mailbox.of('error')[0]?.code).toBe('UNAUTHORIZED');
  });

  it('answers ping with pong (even pre-hello)', () => {
    const { mailbox, send } = rig();
    send({ type: 'ping', ts: 42 });
    expect(mailbox.of('pong')[0]?.ts).toBe(42);
  });

  it('broadcasts deviceSeen to OTHER clients only', () => {
    let t = NOW0;
    const server = new InMemorySyncServer({ now: () => ++t });
    server.register('dev-a', 'Alpha');
    server.register('dev-b', 'Beta');
    const a = server.connectPair('tok-dev-a');
    const b = server.connectPair('tok-dev-b');
    const aGot: Message[] = [];
    const bGot: Message[] = [];
    a.client.onMessage((m) => aGot.push(m));
    b.client.onMessage((m) => bGot.push(m));
    a.client.send({ type: 'hello', token: 'tok-dev-a', protocolVersion: 1, cursor: 0 });
    b.client.send({ type: 'hello', token: 'tok-dev-b', protocolVersion: 1, cursor: 0 });
    expect(aGot.find((m) => m.type === 'deviceSeen')).toMatchObject({ deviceId: 'dev-b' });
    expect(bGot.find((m) => m.type === 'deviceSeen')).toMatchObject({ deviceId: 'dev-a' });
    expect(aGot.filter((m) => m.type === 'deviceSeen')).toHaveLength(1); // not its own
  });
});

describe('InMemorySyncServer — blobs', () => {
  it('putBlob verifies the hash and acknowledges; getBlob round-trips', async () => {
    const { mailbox, send } = rig();
    send({ type: 'hello', token: 'tok-dev-a', protocolVersion: 1, cursor: 0 });
    const hash = await sha256Hex('payload');
    send({ type: 'putBlob', hash, content: btoa('payload') });
    await until(() => mailbox.of('blobAck').length === 1);
    expect(mailbox.of('blobAck')[0]?.hash).toBe(hash);
    send({ type: 'getBlob', hash });
    await until(() => mailbox.of('blob').length === 1);
    const blob = mailbox.of('blob')[0];
    expect(blob?.hash).toBe(hash);
    expect(atob(blob!.content)).toBe('payload');
  });

  it('putBlob with mismatching content is rejected', async () => {
    const { mailbox, send } = rig();
    send({ type: 'hello', token: 'tok-dev-a', protocolVersion: 1, cursor: 0 });
    const hash = await sha256Hex('real content');
    send({ type: 'putBlob', hash, content: btoa('lying content') });
    await until(() => mailbox.of('error').length > 0);
    expect(mailbox.of('error')[0]?.code).toBe('PROTOCOL');
    expect(mailbox.of('blobAck')).toHaveLength(0);
  });

  it('getBlob of an unknown hash is NOT_FOUND', async () => {
    const { mailbox, send } = rig();
    send({ type: 'hello', token: 'tok-dev-a', protocolVersion: 1, cursor: 0 });
    send({ type: 'getBlob', hash: 'f'.repeat(64) });
    await until(() => mailbox.of('error').length > 0);
    expect(mailbox.of('error')[0]?.code).toBe('NOT_FOUND');
  });
});

describe('InMemorySyncServer — commits and manifest', () => {
  async function helloedCommitRig() {
    const base = rig();
    base.send({ type: 'hello', token: 'tok-dev-a', protocolVersion: 1, cursor: 0 });
    const content = 'v1 content';
    const hash = await sha256Hex(content);
    base.send({
      type: 'commit',
      path: '/notes/a.md',
      parentVersion: null,
      hash,
      size: enc(content).byteLength,
      kind: 'edit',
      inline: btoa(content),
    });
    await until(() => base.mailbox.of('commitAck').length === 1);
    return { ...base, hash, content };
  }

  it('accepts an inline commit, stores the blob, and acks with version+clock', async () => {
    const { mailbox, server, hash } = await helloedCommitRig();
    const ack = mailbox.of('commitAck')[0];
    expect(ack).toBeDefined();
    expect(ack!.clock).toEqual({ counter: 1, deviceId: 'dev-a' });
    expect(server.blobs.has(hash)).toBe(true); // CAS store primed for other clients
    expect(server.snapshot().files).toEqual([
      {
        path: '/notes/a.md',
        version: ack!.version,
        hash,
        deleted: false,
        isFolder: false,
        clock: { counter: 1, deviceId: 'dev-a' },
      },
    ]);
  });

  it('rejects an inline commit whose bytes do not hash to the claim', async () => {
    const { mailbox, send } = rig();
    send({ type: 'hello', token: 'tok-dev-a', protocolVersion: 1, cursor: 0 });
    send({
      type: 'commit',
      path: '/x.md',
      parentVersion: null,
      hash: await sha256Hex('truth'),
      size: 5,
      kind: 'edit',
      inline: btoa('false'),
    });
    await until(() => mailbox.of('error').length > 0);
    expect(mailbox.of('error')[0]?.code).toBe('PROTOCOL');
    expect(mailbox.of('commitAck')).toHaveLength(0);
  });

  it('rejects a by-hash commit when the blob was never uploaded', async () => {
    const { mailbox, send } = rig();
    send({ type: 'hello', token: 'tok-dev-a', protocolVersion: 1, cursor: 0 });
    send({
      type: 'commit',
      path: '/x.md',
      parentVersion: null,
      hash: await sha256Hex('never uploaded'),
      size: 14,
      kind: 'edit',
    });
    await until(() => mailbox.of('error').length > 0);
    expect(mailbox.of('error')[0]?.code).toBe('NOT_FOUND');
  });

  it('getManifest returns the full index with cursor', async () => {
    const { mailbox, send, hash } = await helloedCommitRig();
    send({ type: 'getManifest' });
    await until(() => mailbox.of('manifest').length === 1);
    const manifest = mailbox.of('manifest')[0]!;
    expect(manifest.cursor).toBeGreaterThan(0);
    expect(manifest.entries['/notes/a.md']).toMatchObject({ hash, deleted: false });
  });

  it('getManifest since=<cursor> returns only paths whose head advanced', async () => {
    const { mailbox, send } = await helloedCommitRig();
    send({ type: 'getManifest' });
    await until(() => mailbox.of('manifest').length === 1);
    const full = mailbox.of('manifest')[0]!;
    send({ type: 'getManifest', since: full.cursor });
    await until(() => mailbox.of('manifest').length === 2);
    expect(Object.keys(mailbox.of('manifest')[1]!.entries)).toEqual([]);
    send({ type: 'getManifest', since: 0 });
    await until(() => mailbox.of('manifest').length === 3);
    expect(Object.keys(mailbox.of('manifest')[2]!.entries)).toEqual(['/notes/a.md']);
  });

  it('fans out changes to other clients but not the committer', async () => {
    let t = NOW0;
    const server = new InMemorySyncServer({ now: () => ++t });
    server.register('dev-a', 'Alpha');
    server.register('dev-b', 'Beta');
    const a = server.connectPair('tok-dev-a');
    const b = server.connectPair('tok-dev-b');
    const aGot: Message[] = [];
    const bGot: Message[] = [];
    a.client.onMessage((m) => aGot.push(m));
    b.client.onMessage((m) => bGot.push(m));
    a.client.send({ type: 'hello', token: 'tok-dev-a', protocolVersion: 1, cursor: 0 });
    b.client.send({ type: 'hello', token: 'tok-dev-b', protocolVersion: 1, cursor: 0 });
    const content = 'note';
    a.client.send({
      type: 'commit',
      path: '/n.md',
      parentVersion: null,
      hash: await sha256Hex(content),
      size: enc(content).byteLength,
      kind: 'edit',
      inline: btoa(content),
    });
    await until(() => aGot.filter((m) => m.type === 'commitAck').length === 1);
    expect(aGot.filter((m) => m.type === 'change')).toHaveLength(0); // not its own echo
    expect(bGot.find((m) => m.type === 'change')).toMatchObject({
      path: '/n.md',
      device: 'dev-a',
      kind: 'edit',
      deleted: false,
    });
  });

  it('replays missed changes on hello with a cursor', async () => {
    let t = NOW0;
    const server = new InMemorySyncServer({ now: () => ++t });
    server.register('dev-a', 'Alpha');
    const first = server.connectPair('tok-dev-a');
    const firstGot: Message[] = [];
    first.client.onMessage((m) => firstGot.push(m));
    first.client.send({ type: 'hello', token: 'tok-dev-a', protocolVersion: 1, cursor: 0 });
    for (const content of ['x', 'y']) {
      first.client.send({
        type: 'commit',
        path: `/${content}.md`,
        parentVersion: null,
        hash: await sha256Hex(content),
        size: 1,
        kind: 'edit',
        inline: btoa(content),
      });
    }
    await until(() => firstGot.filter((m) => m.type === 'commitAck').length === 2);
    const cursor = server.snapshot().seq;
    expect(cursor).toBeGreaterThanOrEqual(2);

    const reconnectAt = (helloCursor: number): Message[] => {
      const got: Message[] = [];
      const pair = server.connectPair('tok-dev-a');
      pair.client.onMessage((m) => got.push(m));
      pair.client.send({ type: 'hello', token: 'tok-dev-a', protocolVersion: 1, cursor: helloCursor });
      return got;
    };
    // Fully caught up → no replay.
    expect(reconnectAt(cursor).filter((m) => m.type === 'change')).toHaveLength(0);
    // One behind → exactly the missed change.
    expect(reconnectAt(cursor - 1).filter((m) => m.type === 'change')).toHaveLength(1);
    // First-ever connect (cursor 0) replays nothing — the full manifest follows.
    expect(reconnectAt(0).filter((m) => m.type === 'change')).toHaveLength(0);
  });
});
