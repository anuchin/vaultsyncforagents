/**
 * Typed client for the worker's HTTP surface (ARCHITECTURE.md §5): /health,
 * /pair, /admin/*, /api/status, /api/history. Built on an injectable fetch —
 * every method maps transport/HTTP failures to `ApiError`s with actionable
 * messages, so command logic never sees raw `TypeError: fetch failed`.
 */

import type { SnapshotSummary } from '@vsa/core';
import { CommandError } from './runtime.js';

/** Worker call failed (unreachable or unexpected HTTP). */
export class ApiError extends CommandError {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface HealthInfo {
  reachable: boolean;
  claimed: boolean;
  /** Worker-reported Date (ms) parsed from the response header, if present. */
  serverDateMs: number | null;
  /**
   * Worker-reported release version (null on workers ≤ 0.1, which predate
   * version reporting — the compat policy treats that as a warning).
   */
  serverVersion: string | null;
  /** Wire protocol version the worker advertises, when present. */
  protocolVersion: number | null;
  /** Unparsed error when the worker could not be reached. */
  unreachableReason?: string;
}

export interface StatusDevice {
  id: string;
  name: string;
  type: string;
  lastSeen: number;
  revoked: boolean;
  online: boolean;
}

export interface StatusEvent {
  seq: number | null;
  ts: number;
  deviceId: string | null;
  kind: string;
  path: string | null;
}

export interface StatusDoc {
  vaultName: string;
  claimed: boolean;
  health: string;
  /** Worker-reported release version (absent on workers ≤ 0.1). */
  serverVersion?: string | null;
  devices: StatusDevice[];
  lastEdit: { ts: number; deviceId: string; path: string } | null;
  attachments: { count: number; bytes: number };
  storageBytes: number;
  recentEvents: StatusEvent[];
}

export interface HistoryVersion {
  id: string;
  hash: string;
  size: number;
  deviceId: string;
  clock: { counter: number; deviceId: string };
  ts: number;
  kind: string;
  current: boolean;
}

export interface HistoryDoc {
  path: string;
  head: { versionId: string; deleted: boolean } | null;
  versions: HistoryVersion[];
}

export interface WorkerApiOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  /** Local clock for skew measurement in health(). */
  now?: () => number;
}

export class WorkerApi {
  private readonly base: string;
  private readonly doFetch: typeof fetch;
  private readonly now: () => number;

  constructor(options: WorkerApiOptions) {
    let base = options.baseUrl.trim().replace(/\/+$/, '');
    if (base !== '' && !/^https?:\/\//i.test(base)) base = `https://${base}`;
    try {
      // Validate + normalize (also tolerates a trailing path, which we drop).
      base = new URL(base).origin;
    } catch {
      throw new CommandError(`invalid worker URL: ${JSON.stringify(options.baseUrl)}`);
    }
    this.base = base;
    this.doFetch = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => Date.now());
  }

  get origin(): string {
    return this.base;
  }

  /** GET /health — never throws for reachability; claims state + server Date. */
  async health(): Promise<HealthInfo> {
    let response: Response;
    try {
      response = await this.doFetch(`${this.base}/health`);
    } catch (error) {
      return {
        reachable: false,
        claimed: false,
        serverDateMs: null,
        serverVersion: null,
        protocolVersion: null,
        unreachableReason: error instanceof Error ? error.message : String(error),
      };
    }
    if (!response.ok) {
      return {
        reachable: false,
        claimed: false,
        serverDateMs: null,
        serverVersion: null,
        protocolVersion: null,
        unreachableReason: `HTTP ${response.status}`,
      };
    }
    const body = (await response.json().catch(() => ({}))) as {
      claimed?: boolean;
      serverVersion?: unknown;
      protocolVersion?: unknown;
    };
    const dateHeader = response.headers.get('date');
    return {
      reachable: true,
      claimed: body.claimed === true,
      serverDateMs: dateHeader === null ? null : Date.parse(dateHeader),
      serverVersion: typeof body.serverVersion === 'string' ? body.serverVersion : null,
      protocolVersion: typeof body.protocolVersion === 'number' ? body.protocolVersion : null,
    };
  }

  /** GET /api/status with the vault's device token. */
  async status(token: string): Promise<StatusDoc> {
    return this.getJson<StatusDoc>('/api/status', token);
  }

  /** GET /api/history?path=… (FR-54). */
  async history(token: string, path: string): Promise<HistoryDoc> {
    return this.getJson<HistoryDoc>(`/api/history?path=${encodeURIComponent(path)}`, token);
  }

  /** GET /api/snapshots — vault-level snapshots, newest-first. */
  async snapshots(token: string): Promise<SnapshotSummary[]> {
    const body = await this.getJson<{ snapshots: SnapshotSummary[] }>('/api/snapshots', token);
    return body.snapshots;
  }

  /** POST /pair — redeem a pairing code for a device token. */
  async pair(
    code: string,
    deviceName: string,
    deviceType: 'desktop' | 'mobile' | 'daemon' | 'cli' = 'cli',
  ): Promise<{ token: string; deviceId: string }> {
    const body = await this.postJson('/pair', { code, deviceName, deviceType });
    return { token: body['token'] as string, deviceId: body['deviceId'] as string };
  }

  /** POST /admin/login → raw `vsa_admin=…` cookie value. */
  async adminLogin(passphrase: string): Promise<{ cookie: string }> {
    const response = await this.doFetch(`${this.base}/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ passphrase }),
    });
    if (response.status === 401) {
      throw new ApiError('admin passphrase rejected', 401);
    }
    const setCookie = response.headers.get('set-cookie');
    if (!response.ok || setCookie === null) {
      throw new ApiError(`admin login failed: HTTP ${response.status}`, response.status);
    }
    return { cookie: setCookie.split(';')[0]! };
  }

  /** POST /admin/revoke (admin session). */
  async adminRevoke(cookie: string, deviceId: string): Promise<void> {
    const response = await this.doFetch(`${this.base}/admin/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ deviceId }),
    });
    if (!response.ok) {
      throw new ApiError(
        `revoke failed: HTTP ${response.status} ${(await response.text().catch(() => '')).slice(0, 200)}`,
        response.status,
      );
    }
  }

  // --- plumbing -------------------------------------------------------------------------

  private async getJson<T>(path: string, token: string): Promise<T> {
    const response = await this.request(path, 'GET', token);
    if (response.status === 401 || response.status === 403) {
      throw new ApiError('device token was rejected (revoked or invalid — re-pair this vault)', response.status);
    }
    return (await expectOk(response, path)) as T;
  }

  private async postJson(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await this.doFetch(`${this.base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return expectOk(response, path);
  }

  private async request(
    path: string,
    method: string,
    token: string,
    init: RequestInit = {},
  ): Promise<Response> {
    let response: Response;
    try {
      response = await this.doFetch(`${this.base}${path}`, {
        ...init,
        method,
        headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${token}` },
      });
    } catch (error) {
      throw new ApiError(
        `could not reach the worker at ${this.base}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return response;
  }
}

async function expectOk(response: Response, path: string): Promise<Record<string, unknown>> {
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 200);
    throw new ApiError(`${path} failed: HTTP ${response.status} ${detail}`.trim(), response.status);
  }
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new ApiError(`${path} returned a non-JSON body`, response.status);
  }
}
