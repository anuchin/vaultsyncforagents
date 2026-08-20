import { describe, expect, it } from 'vitest';
import { pairWithWorker, pairOutcomeMessage, unclaimedGuidance } from '../src/pairing.js';
import { normalizeWorkerUrl } from '../src/workerapi.js';
import { FakeFetch } from './helpers/network-fakes.js';

describe('normalizeWorkerUrl', () => {
  it('normalizes schemeless, trailing-slash, and path-ful input to an origin', () => {
    expect(normalizeWorkerUrl('personal.x.workers.dev')).toBe('https://personal.x.workers.dev');
    expect(normalizeWorkerUrl('https://personal.x.workers.dev/')).toBe(
      'https://personal.x.workers.dev',
    );
    expect(normalizeWorkerUrl('http://localhost:8787/some/path')).toBe('http://localhost:8787');
  });

  it('rejects garbage and non-http schemes', () => {
    expect(() => normalizeWorkerUrl('')).toThrow(/empty/);
    expect(() => normalizeWorkerUrl('not a url')).toThrow(/invalid/);
    expect(() => normalizeWorkerUrl('ftp://example.com')).toThrow(/http/);
  });
});

describe('pairWithWorker', () => {
  it('pairs against a claimed worker and returns credentials', async () => {
    const fetcher = new FakeFetch().health(true).pair(200, { ok: true, token: 'T', deviceId: 'D' });
    const outcome = await pairWithWorker({
      url: 'personal.x.workers.dev',
      code: '7F3K-Q9M2',
      deviceName: 'Pixel',
      deviceType: 'mobile',
      fetchImpl: fetcher.fetchImpl,
    });

    expect(outcome).toEqual({
      status: 'paired',
      url: 'https://personal.x.workers.dev',
      token: 'T',
      deviceId: 'D',
    });
    // The pair request carries device metadata for the registry.
    const pairCall = fetcher.calls.find((c) => c.url.endsWith('/pair'))!;
    expect(JSON.parse(String(pairCall.init?.body))).toEqual({
      code: '7F3K-Q9M2',
      deviceName: 'Pixel',
      deviceType: 'mobile',
    });
  });

  it('unclaimed worker → friendly onboarding guidance (health-first probe)', async () => {
    const fetcher = new FakeFetch().health(false);
    const outcome = await pairWithWorker({
      url: 'https://w.example',
      code: 'CODE',
      deviceName: 'Desk',
      deviceType: 'desktop',
      fetchImpl: fetcher.fetchImpl,
    });

    expect(outcome.status).toBe('unclaimed');
    if (outcome.status !== 'unclaimed') return;
    expect(outcome.url).toBe('https://w.example');
    expect(outcome.guidance).toContain('Open https://w.example');
    expect(outcome.guidance).toContain('admin passphrase');
    expect(outcome.guidance).toContain('pairing code');
    // No pair attempt was made against the unclaimed worker.
    expect(fetcher.calls.filter((c) => c.url.endsWith('/pair'))).toHaveLength(0);
    expect(pairOutcomeMessage(outcome)).toBe(outcome.guidance);
  });

  it('rejected code (401) → clear, actionable error', async () => {
    const fetcher = new FakeFetch()
      .health(true)
      .pair(401, { error: 'pairing code is invalid, expired, or already used' });
    const outcome = await pairWithWorker({
      url: 'https://w.example',
      code: 'STALE',
      deviceName: 'Desk',
      deviceType: 'desktop',
      fetchImpl: fetcher.fetchImpl,
    });

    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected') {
      expect(outcome.reason).toMatch(/one-time/);
      expect(pairOutcomeMessage(outcome)).toContain('Pairing failed');
    }
  });

  it('revoked-style 403 from /pair also reads as rejected', async () => {
    const fetcher = new FakeFetch().health(true).pair(403, { error: 'forbidden' });
    const outcome = await pairWithWorker({
      url: 'https://w.example',
      code: 'X',
      deviceName: 'Desk',
      deviceType: 'desktop',
      fetchImpl: fetcher.fetchImpl,
    });
    expect(outcome.status).toBe('rejected');
  });

  it('unreachable worker → unreachable outcome with reason', async () => {
    const fetcher = new FakeFetch(); // no routes: fetch throws
    const outcome = await pairWithWorker({
      url: 'https://w.example',
      code: 'C',
      deviceName: 'Desk',
      deviceType: 'desktop',
      fetchImpl: fetcher.fetchImpl,
    });
    expect(outcome.status).toBe('unreachable');
    if (outcome.status === 'unreachable') {
      expect(outcome.reason).toContain('worker is deployed');
    }
  });

  it('invalid URL input → invalid-url outcome', async () => {
    const fetcher = new FakeFetch();
    const outcome = await pairWithWorker({
      url: 'silly input',
      code: 'C',
      deviceName: 'Desk',
      deviceType: 'desktop',
      fetchImpl: fetcher.fetchImpl,
    });
    expect(outcome).toEqual({ status: 'invalid-url', input: 'silly input' });
    expect(pairOutcomeMessage(outcome)).toContain('not look like a worker URL');
  });

  it('unclaimedGuidance mentions every setup step', () => {
    const text = unclaimedGuidance('https://w.example');
    expect(text).toContain('claim');
    expect(text).toContain('Devices → Pair new device');
  });
});
