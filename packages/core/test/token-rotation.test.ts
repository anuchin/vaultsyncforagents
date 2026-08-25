/**
 * Device-token rotation: a token older than the configured interval is
 * re-issued in the helloAck (`nextToken`), the client hands it to
 * `onTokenRotated` for persistence, and the previous token survives only
 * the grace window — rotation never wedges an honest device that missed
 * the hand-off, but a leaked token's life is bounded.
 */

import { describe, expect, it } from 'vitest';

import {
  InMemoryStorageAdapter,
  InMemorySyncServer,
  SyncClient,
  type BlobStore,
} from '../src/index.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

function makeBlobStore(): BlobStore {
  const map = new Map<string, Uint8Array>();
  return {
    get: async (hash) => map.get(hash),
    put: async (hash, bytes) => {
      map.set(hash, bytes);
    },
  };
}

describe('token rotation (in-memory server)', () => {
  it('re-issues an aged token in the ack; the old one works through grace, then dies', async () => {
    let t = 1_000_000;
    const now = (): number => ++t;
    const GRACE = 1_000;
    const server = new InMemorySyncServer({
      now,
      vaultName: 'v',
      tokenRotationMs: 10,
      tokenRotationGraceMs: GRACE,
    });
    server.register('dev-a', 'Alpha');

    const rotated: string[] = [];
    const connectWith = async (token: string): Promise<void> => {
      const client = new SyncClient({
        deviceId: 'dev-a',
        deviceName: 'Alpha',
        token,
        transport: () => server.connectPair(token).client,
        blobStore: makeBlobStore(),
        storage: new InMemoryStorageAdapter({}, { now: () => ++t }),
        now,
        schedule: (fn) => {
          fn(); // immediate — no debounce in this test
          return () => {};
        },
        onTokenRotated: (next) => {
          rotated.push(next);
        },
      });
      await client.connect();
      client.close();
    };

    // First hello rotates immediately (issued-at 0 < now - interval) and the
    // ack's replacement reaches the persistence hook.
    await connectWith('tok-dev-a');
    expect(rotated).toHaveLength(1);
    const next = rotated[0]!;

    // The OLD token still authenticates within the grace window — an honest
    // device that missed the hand-off gets another successful hello.
    await connectWith('tok-dev-a');
    expect(rotated).toHaveLength(2); // rotated again (interval already passed)

    // After the grace lapses, the original token is dead; the current one lives.
    t += GRACE + 10;
    await expect(connectWith('tok-dev-a')).rejects.toThrow(/token/i);
    await connectWith(rotated[rotated.length - 1]!);
  });
});
