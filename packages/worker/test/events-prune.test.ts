/**
 * Events pruning (§6): the event log is a feed, not a ledger — rows older
 * than 30 days and beyond the newest 10,000 are deleted, opportunistically
 * on event writes (hourly watermark) and by the weekly GC cron. Versions are
 * never pruned (history is kept forever, FR-7).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index.js';
import { adminLogin, claim, claimOnly, get, mintPairingCode, pair, resetAll, roomSql } from './helpers.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const VERSION_ROW =
  "INSERT INTO versions (id, path, hash, size, device_id, clock_counter, clock_device, parent_id, ts, kind) " +
  "VALUES ('v-keep', '/keep.md', 'cafebabe', 9, 'dev-keep', 1, 'dev-keep', NULL, 1, 'edit')";

async function runCron(): Promise<void> {
  const controller = createScheduledController();
  const ctx = createExecutionContext();
  await worker.scheduled(controller, env, ctx);
  await waitOnExecutionContext(ctx);
}

/** Seed `rows` change events at `ts`, batched to keep statements small. */
async function seedEvents(ts: number, rows: number): Promise<void> {
  const BATCH = 500;
  for (let offset = 0; offset < rows; offset += BATCH) {
    const n = Math.min(BATCH, rows - offset);
    const values = Array.from(
      { length: n },
      (_, i) => `(${ts}, NULL, 'change', '/seed/${offset + i}.md', NULL, NULL)`,
    ).join(', ');
    await roomSql(
      `INSERT INTO events (ts, device_id, kind, path, seq, detail) VALUES ${values}`,
    );
  }
}

/** One more event write through the real API (device_paired on /pair). */
async function triggerEventWrite(): Promise<void> {
  const cookie = await adminLogin('pppppppp');
  const code = await mintPairingCode(cookie, 'Trigger', 'cli');
  await pair(code, 'Trigger', 'cli');
}

const eventCount = (): Promise<number> =>
  roomSql<{ count: number }>('SELECT COUNT(*) AS count FROM events').then((rows) => rows[0]!.count);

beforeEach(async () => {
  await resetAll();
});

describe('events pruning', () => {
  it('opportunistically prunes rows older than 30 days on the next event write', async () => {
    await claimOnly('pppppppp', 'v'); // writes the 'claimed' event only
    const nowMs = Date.now();
    await seedEvents(nowMs - 31 * DAY_MS, 3); // ancient
    await seedEvents(nowMs - 60_000, 2); // recent
    await roomSql(VERSION_ROW);
    // Re-arm the hourly watermark so the next write must prune.
    await roomSql("DELETE FROM meta WHERE key = 'events_last_prune'");

    await triggerEventWrite();

    // Ancient rows are gone; recent seeds + 'claimed' + 'device_paired' stay.
    expect(await eventCount()).toBe(4);
    const stale = await roomSql<{ count: number }>(
      `SELECT COUNT(*) AS count FROM events WHERE ts < ${nowMs - 30 * DAY_MS}`,
    );
    expect(stale[0]!.count).toBe(0);
    const kinds = (await roomSql<{ kind: string }>('SELECT kind FROM events')).map((r) => r.kind).sort();
    expect(kinds).toEqual(['change', 'change', 'claimed', 'device_paired']);
    // Versions are untouched by event pruning (FR-7).
    expect(await roomSql('SELECT id FROM versions')).toEqual([{ id: 'v-keep' }]);
  });

  it('keeps at most the 10,000 most recent events; recentEvents(50) unaffected', async () => {
    const claimed = await claim({ passphrase: 'pppppppp', vaultName: 'v' });
    const nowMs = Date.now();
    await seedEvents(nowMs, 10_050); // all fresh, over the cap
    await roomSql(VERSION_ROW);
    await roomSql("DELETE FROM meta WHERE key = 'events_last_prune'");

    await triggerEventWrite(); // table now holds 10,052 rows

    // Newest 10,000 survive: the oldest 52 (claim + seeds) are gone, the
    // freshly written device_paired event is the newest row of all.
    expect(await eventCount()).toBe(10_000);
    expect((await roomSql<{ kind: string }>('SELECT kind FROM events ORDER BY id DESC LIMIT 1'))[0]!.kind).toBe(
      'device_paired',
    );
    expect(await roomSql<{ count: number }>("SELECT COUNT(*) AS count FROM events WHERE kind = 'claimed'")).toEqual(
      [{ count: 0 }],
    );
    expect(await roomSql('SELECT id FROM versions')).toEqual([{ id: 'v-keep' }]);

    // The dashboard/`vsa logs` feed still serves its 50 most recent events.
    const statusRes = await get('/api/status', { authorization: `Bearer ${claimed.token}` });
    expect(statusRes.status).toBe(200);
    const status = (await statusRes.json()) as { recentEvents: Array<{ kind: string }> };
    expect(status.recentEvents).toHaveLength(50);
    expect(status.recentEvents[0]!.kind).toBe('device_paired');
  });

  it('the weekly GC cron prunes old events too (no event write needed)', async () => {
    await claimOnly('pppppppp', 'v');
    const nowMs = Date.now();
    await seedEvents(nowMs - 40 * DAY_MS, 3);
    await seedEvents(nowMs - 60_000, 2);
    await roomSql(VERSION_ROW);

    await runCron();

    expect(await eventCount()).toBe(3); // 2 recent seeds + 'claimed'
    expect(await roomSql('SELECT id FROM versions')).toEqual([{ id: 'v-keep' }]);
  });
});
