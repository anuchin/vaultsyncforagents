/**
 * Test helpers — a tiny WS client speaking the REAL wire protocol
 * (`ClientMessage`/`ServerMessage` from `@vsa/core`) over the pool-workers
 * environment, plus claim/login/pairing conveniences against `SELF`.
 */

import { SELF, env, runInDurableObject } from 'cloudflare:test';
import {
  bytesToBase64,
  sha256Hex,
  type ClientMessage,
  type ServerMessage,
} from '@vsa/core';

// The pool-workers `env` is `ProvidedEnv`; bind it to this worker's bindings.
declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {} // eslint-disable-line @typescript-eslint/no-empty-object-type
}

export const TEST_ORIGIN = 'http://vault.test';

export function get(path: string, headers?: Record<string, string>): Promise<Response> {
  return SELF.fetch(`${TEST_ORIGIN}${path}`, { headers });
}

/** Arbitrary-method request through the worker under test (never real DNS). */
export function request(method: string, path: string, headers?: Record<string, string>): Promise<Response> {
  return SELF.fetch(`${TEST_ORIGIN}${path}`, { method, headers });
}

export function post(path: string, body: unknown, headers?: Record<string, string>): Promise<Response> {
  return SELF.fetch(`${TEST_ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(headers ?? {}) },
    body: JSON.stringify(body),
  });
}

export function put(path: string, body: BodyInit, headers?: Record<string, string>): Promise<Response> {
  return SELF.fetch(`${TEST_ORIGIN}${path}`, { method: 'PUT', body, headers });
}

export interface Claimed {
  token: string;
  deviceId: string;
  vaultName: string;
  passphrase: string;
}

/** Claim the (isolated, fresh) worker and get the claiming device's token. */
export async function claim(options: { passphrase?: string; vaultName?: string; deviceName?: string } = {}): Promise<Claimed> {
  const passphrase = options.passphrase ?? 'correct-horse-battery';
  const vaultName = options.vaultName ?? 'personal';
  const res = await post('/claim', {
    passphrase,
    vaultName,
    ...(options.deviceName !== undefined ? { deviceName: options.deviceName } : {}),
  });
  if (res.status !== 200) throw new Error(`claim failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { token: string; deviceId: string };
  return { ...body, vaultName, passphrase };
}

/** Admin login -> raw cookie header value (`vsa_admin=...`). */
export async function adminLogin(passphrase: string): Promise<string> {
  const res = await post('/admin/login', { passphrase });
  if (res.status !== 200) throw new Error(`admin login failed: ${res.status}`);
  const setCookie = res.headers.get('set-cookie');
  if (setCookie === null) throw new Error('no set-cookie on admin login');
  return setCookie.split(';')[0]!;
}

export async function mintPairingCode(
  cookie: string,
  deviceName: string,
  deviceType = 'desktop',
): Promise<string> {
  const res = await post('/admin/pair', { deviceName, deviceType }, { cookie });
  if (res.status !== 200) throw new Error(`pair mint failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { code: string }).code;
}

export async function pair(
  code: string,
  deviceName: string,
  deviceType = 'desktop',
): Promise<{ token: string; deviceId: string }> {
  const res = await post('/pair', { code, deviceName, deviceType });
  if (res.status !== 200) throw new Error(`pair failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { token: string; deviceId: string };
}

/**
 * Call `runInDurableObject` with retries: calls can transiently fail with
 * "index.ts changed, invalidating this Durable Object; please retry" after a
 * module (re)load — the sanctioned fix is retrying, with a FRESH stub
 * (stubs bind to the instance they were created against).
 */
async function inRoom<T>(
  callback: (instance: never, state: DurableObjectState) => T,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const stub = env.ROOM.get(env.ROOM.idFromName('vault'));
      return await runInDurableObject(stub as never, callback as never);
    } catch (error) {
      if (attempt >= 5 || !String(error).includes('invalidating this Durable Object')) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

/** Run SQL inside the real DO instance (seeding / assertions). */
export function roomSql<T>(query: string): Promise<T[]> {
  return inRoom<T[]>((_instance, state) => {
    return Array.from(state.storage.sql.exec(query).toArray()) as T[];
  });
}

/**
 * Reset the vault to factory state (unclaimed, empty tables, empty bucket).
 *
 * Stands in for the pool's `isolatedStorage` (disabled on Windows — see
 * vitest.workers.config.ts): every test file calls this in `beforeEach`, so
 * each test starts as a freshly deployed worker.
 */
export async function resetAll(): Promise<void> {
  await inRoom((_instance, state) => {
    const sql = state.storage.sql;
    for (const table of ['files', 'versions', 'devices', 'events', 'pairs', 'blobs', 'meta']) {
      try {
        sql.exec(`DELETE FROM ${table}`);
      } catch {
        // table not created yet (pre-first-request)
      }
    }
  });
  // Drain the R2 bucket (tests keep object counts small).
  for (;;) {
    const listed = await env.BUCKET.list();
    if (listed.objects.length === 0) break;
    await env.BUCKET.delete(listed.objects.map((object) => object.key));
    if (!listed.truncated) break;
  }
}

// --- the WS test client -------------------------------------------------------------

export class WsClient {
  readonly messages: ServerMessage[] = [];
  private readonly ws: WebSocket;
  private readonly buffer: ServerMessage[] = [];
  private readonly waiters: Array<{
    match: (message: ServerMessage) => boolean;
    resolve: (message: ServerMessage) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];
  private readonly closeWaiters: Array<() => void> = [];
  closed = false;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as ServerMessage;
      this.messages.push(message);
      const index = this.waiters.findIndex((waiter) => waiter.match(message));
      if (index >= 0) {
        const waiter = this.waiters[index]!;
        this.waiters.splice(index, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      } else {
        this.buffer.push(message);
      }
    });
    ws.addEventListener('close', () => {
      this.closed = true;
      for (const notify of this.closeWaiters.splice(0)) notify();
    });
  }

  static async connect(path = '/ws'): Promise<WsClient> {
    const res = await SELF.fetch(`${TEST_ORIGIN}${path}`, {
      headers: { Upgrade: 'websocket' },
    });
    if (res.webSocket == null) {
      throw new Error(`WS upgrade failed: ${res.status} ${await res.text()}`);
    }
    const ws = res.webSocket;
    ws.accept();
    return new WsClient(ws);
  }

  send(message: ClientMessage): void {
    this.ws.send(JSON.stringify(message));
  }

  /** Next message matching `match` (buffered first, then live), or throws. */
  next(match: (message: ServerMessage) => boolean = () => true, timeoutMs = 4000): Promise<ServerMessage> {
    const index = this.buffer.findIndex(match);
    if (index >= 0) {
      return Promise.resolve(this.buffer.splice(index, 1)[0]!);
    }
    return new Promise<ServerMessage>((resolve, reject) => {
      const waiter = {
        match,
        resolve,
        timer: setTimeout(() => {
          const at = this.waiters.indexOf(waiter);
          if (at >= 0) this.waiters.splice(at, 1);
          reject(new Error(`timed out waiting for message; got ${JSON.stringify(this.messages.map((m) => m.type))}`));
        }, timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  /** Resolves when the server closes the socket. */
  waitClosed(timeoutMs = 4000): Promise<void> {
    if (this.closed) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('socket was not closed in time')), timeoutMs);
      this.closeWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      // already closed
    }
  }
}

/** hello over the wire and wait for the ack. */
export async function hello(client: WsClient, token: string, cursor = 0): Promise<ServerMessage> {
  const ackPromise = client.next((m) => m.type === 'helloAck' || m.type === 'error');
  client.send({ type: 'hello', token, protocolVersion: 1, cursor });
  return ackPromise;
}

// --- content helpers -----------------------------------------------------------------

export const enc = (text: string): Uint8Array => new TextEncoder().encode(text);
export const dec = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
export const b64 = bytesToBase64;

export async function hashOf(bytes: Uint8Array): Promise<string> {
  return sha256Hex(bytes);
}
