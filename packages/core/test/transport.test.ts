import { describe, expect, it } from 'vitest';

import { MessageBus, MemoryTransport, type Transport } from '../src/index.js';
import { NetworkError } from '../src/errors.js';
import type { Message } from '../src/protocol.js';

const hello: Message = { type: 'hello', token: 't', protocolVersion: 1, cursor: 0 };
const pong: Message = { type: 'pong', ts: 7 };

describe('MessageBus — synchronous delivery', () => {
  it('delivers client→server and server→client within send()', () => {
    const bus = new MessageBus();
    const { client, server } = bus.connectPair();
    const gotServer: Message[] = [];
    const gotClient: Message[] = [];
    server.onMessage((m) => gotServer.push(m));
    client.onMessage((m) => gotClient.push(m));

    client.send(hello);
    expect(gotServer).toEqual([hello]);
    server.send(pong);
    expect(gotClient).toEqual([pong]);
  });

  it('supports multiple independent pairs', () => {
    const bus = new MessageBus();
    const a = bus.connectPair();
    const b = bus.connectPair();
    const gotA: Message[] = [];
    const gotB: Message[] = [];
    a.server.onMessage((m) => gotA.push(m));
    b.server.onMessage((m) => gotB.push(m));

    a.client.send(hello);
    expect(gotA).toEqual([hello]);
    expect(gotB).toEqual([]);
  });

  it('clones messages across the wire — receiver mutation cannot reach the sender', () => {
    const bus = new MessageBus();
    const { client, server } = bus.connectPair();
    let received: Message | undefined;
    server.onMessage((m) => {
      received = m;
    });
    client.send(hello);
    expect(received).toEqual(hello);
    expect(received).not.toBe(hello);
    (received as { token?: string }).token = 'mutated';
    expect(hello.token).toBe('t');
  });

  it('the last onMessage registration wins', () => {
    const bus = new MessageBus();
    const { client, server } = bus.connectPair();
    const first: Message[] = [];
    const second: Message[] = [];
    server.onMessage((m) => first.push(m));
    server.onMessage((m) => second.push(m));
    client.send(hello);
    expect(first).toEqual([]);
    expect(second).toEqual([hello]);
  });
});

describe('MessageBus — disconnect', () => {
  it('closing one side fires onClose on the closer first, then the peer', () => {
    const bus = new MessageBus();
    const { client, server } = bus.connectPair();
    const reasons: string[] = [];
    client.onClose((r) => reasons.push(`client:${r.reason}`));
    server.onClose((r) => reasons.push(`server:${r.reason}`));

    server.close({ code: 1001, reason: 'going away' });
    expect(reasons).toEqual(['server:going away', 'client:going away']);
    expect(client.isOpen).toBe(false);
    expect(server.isOpen).toBe(false);
  });

  it('send after close throws NetworkError', () => {
    const bus = new MessageBus();
    const { client } = bus.connectPair();
    client.close();
    expect(() => client.send(hello)).toThrow(NetworkError);
  });

  it('when the peer closes, this side is closed too and send throws', () => {
    const bus = new MessageBus();
    const { client, server } = bus.connectPair();
    server.close();
    expect(client.isOpen).toBe(false);
    expect(() => client.send(hello)).toThrow(NetworkError);
  });

  it('close is idempotent — callbacks fire exactly once', () => {
    const bus = new MessageBus();
    const { client, server } = bus.connectPair();
    let count = 0;
    server.onClose(() => {
      count += 1;
    });
    client.close();
    client.close();
    expect(count).toBe(1);
  });
});

describe('MessageBus — injected delivery scheduling (artificial latency)', () => {
  it('defers deliveries until the scheduler flushes them, in order', () => {
    const pending: Array<() => void> = [];
    const bus = new MessageBus({ scheduleDelivery: (deliver) => pending.push(deliver) });
    const { client, server } = bus.connectPair();
    const got: number[] = [];
    server.onMessage((m) => got.push((m as { cursor: number }).cursor));

    client.send({ ...hello, cursor: 1 });
    client.send({ ...hello, cursor: 2 });
    expect(got).toEqual([]); // nothing delivered yet

    pending.splice(0).forEach((deliver) => deliver());
    expect(got).toEqual([1, 2]);
  });

  it('delivers only while the peer is still open (drop on disconnect)', () => {
    const pending: Array<() => void> = [];
    const bus = new MessageBus({ scheduleDelivery: (deliver) => pending.push(deliver) });
    const { client, server } = bus.connectPair();
    const got: Message[] = [];
    server.onMessage((m) => got.push(m));

    client.send(hello);
    client.close();
    pending.splice(0).forEach((deliver) => deliver());
    expect(got).toEqual([]);
  });
});

describe('MemoryTransport implements Transport', () => {
  it('satisfies the interface (compile-time contract)', () => {
    const transport: Transport = new MemoryTransport();
    expect(typeof transport.send).toBe('function');
    expect(typeof transport.close).toBe('function');
  });
});
