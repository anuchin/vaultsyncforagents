/**
 * Thin fetch layer for the worker's HTTP surface. Cookies ride along
 * automatically (same-origin), so the admin session set by POST /admin/login
 * authorizes /api/* and /blob/* without any manual handling.
 *
 * Every failure is an `ApiError` with a `kind` the state machine understands:
 * 401 -> 'unauthorized', 421 -> 'unclaimed', fetch rejection -> 'network'.
 */

import type { ClaimResult, HealthDoc, HistoryDoc, PairCodeDoc, StatusDoc } from './types.js';

export type ApiErrorKind = 'unauthorized' | 'unclaimed' | 'http' | 'network';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;

  constructor(kind: ApiErrorKind, status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      headers: { accept: 'application/json', ...(init?.headers ?? {}) },
    });
  } catch (cause) {
    throw new ApiError('network', 0, cause instanceof Error ? cause.message : 'network error');
  }
  if (!response.ok) {
    const kind: ApiErrorKind =
      response.status === 401 ? 'unauthorized' : response.status === 421 ? 'unclaimed' : 'http';
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
    const message =
      typeof body?.error === 'string' ? body.error : `request failed with HTTP ${response.status}`;
    throw new ApiError(kind, response.status, message);
  }
  return (await response.json()) as T;
}

function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export const api = {
  /** Public liveness + claim state — drives the bootstrap branch. */
  health(): Promise<HealthDoc> {
    return request<HealthDoc>('/health');
  },

  /** First-writer-wins claim (min 4-char passphrase, non-empty vault name). */
  claim(payload: {
    passphrase: string;
    vaultName: string;
    deviceName?: string;
    deviceType?: string;
  }): Promise<ClaimResult> {
    return post<ClaimResult>('/claim', payload);
  },

  /** Passphrase -> signed admin session cookie (12 h). */
  adminLogin(passphrase: string): Promise<{ ok: boolean; expiresAt: number }> {
    return post('/admin/login', { passphrase });
  },

  /**
   * Rotate the admin passphrase (POST /admin/passphrase-change). The server
   * verifies `current`, replaces the hash, rotates the session secret (every
   * OTHER admin session dies instantly), and re-issues a fresh cookie on this
   * response — so this tab stays signed in. A 401 whose message names the
   * current passphrase ("invalid current passphrase") is a validation error;
   * any other 401 means this session itself is stale (e.g. a rotation in
   * another tab) and maps to the login view like everywhere else.
   */
  adminPassphraseChange(current: string, next: string): Promise<{ ok: boolean; expiresAt: number }> {
    return post('/admin/passphrase-change', { current, next });
  },

  /** Mint a one-time pairing code (10-min TTL). */
  adminPair(deviceName: string, deviceType: string): Promise<PairCodeDoc> {
    return post<PairCodeDoc>('/admin/pair', { deviceName, deviceType });
  },

  /** Mark a device revoked; its token stops working immediately. */
  adminRevoke(deviceId: string): Promise<{ ok: boolean }> {
    return post('/admin/revoke', { deviceId });
  },

  /** The status document (FR-31): health, devices, last edit, usage, feed. */
  status(): Promise<StatusDoc> {
    return request<StatusDoc>('/api/status');
  },

  /** Version chain for one absolute vault path (restore browsing). */
  history(path: string): Promise<HistoryDoc> {
    return request<HistoryDoc>(`/api/history?path=${encodeURIComponent(path)}`);
  },
};
