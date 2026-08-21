/**
 * Minimal typed client for the worker's HTTP surface as the plugin uses it:
 * `GET /health` (claim-state probe before pairing), `POST /pair` (redeem a
 * pairing code, ARCHITECTURE §3), `PATCH /device` (device self-service
 * rename), and `GET /api/status` (storage/device summary for About). Built
 * on an injectable `fetch`; failures map to typed errors with actionable
 * messages so the settings UI and the deep-link handler never see a raw
 * `TypeError: Failed to fetch`.
 */

/** A worker call failed (unreachable or unexpected HTTP). */
export class WorkerApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'WorkerApiError';
  }
}

/** The pairing code was rejected (invalid / expired / already used). */
export class PairRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PairRejectedError';
  }
}

/** The worker exists but has not been claimed yet (HTTP 421 semantics). */
export class UnclaimedWorkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnclaimedWorkerError';
  }
}

export interface HealthInfo {
  reachable: boolean;
  claimed: boolean;
  /** Human-readable reason when the worker could not be reached. */
  reason?: string;
}

export interface PairCredentials {
  token: string;
  deviceId: string;
}

/**
 * Normalize user input into a worker origin: trims, tolerates a missing
 * scheme (assumes https), a trailing slash, and stray path components;
 * returns `https://host` style origin. Throws `WorkerApiError` on garbage.
 */
export function normalizeWorkerUrl(input: string): string {
  let candidate = input.trim();
  if (candidate === '') throw new WorkerApiError('worker URL is empty');
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(candidate)) candidate = `https://${candidate}`;
  let origin: string;
  try {
    origin = new URL(candidate).origin;
  } catch {
    throw new WorkerApiError(`invalid worker URL: ${JSON.stringify(input)}`);
  }
  if (!origin.startsWith('http://') && !origin.startsWith('https://')) {
    throw new WorkerApiError(`worker URL must be http(s), got ${origin}`);
  }
  return origin;
}

/** GET /health — never throws for reachability; reports claim state instead. */
export async function fetchHealth(
  origin: string,
  fetchImpl: typeof fetch,
): Promise<HealthInfo> {
  let response: Response;
  try {
    response = await fetchImpl(`${origin}/health`);
  } catch (error) {
    return {
      reachable: false,
      claimed: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  if (!response.ok) {
    return { reachable: false, claimed: false, reason: `HTTP ${response.status}` };
  }
  const body = (await response.json().catch(() => ({}))) as { claimed?: boolean };
  return { reachable: true, claimed: body.claimed === true };
}

export interface PairRequestParams {
  origin: string;
  code: string;
  deviceName: string;
  deviceType: 'desktop' | 'mobile';
  fetchImpl: typeof fetch;
}

/**
 * POST /pair — redeem a one-time pairing code for long-lived device
 * credentials. Throws `PairRejectedError` (bad code), `UnclaimedWorkerError`
 * (421), or `WorkerApiError` (unreachable / unexpected).
 */
export async function requestPair(params: PairRequestParams): Promise<PairCredentials> {
  let response: Response;
  try {
    response = await params.fetchImpl(`${params.origin}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: params.code,
        deviceName: params.deviceName,
        deviceType: params.deviceType,
      }),
    });
  } catch (error) {
    throw new WorkerApiError(
      `could not reach the worker at ${params.origin}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  // Read the body once (a Response body is single-use) and parse from text.
  const detail = (await response.text().catch(() => '')).trim();
  if (response.status === 421) {
    throw new UnclaimedWorkerError('this worker has not been claimed yet');
  }
  if (response.status === 401 || response.status === 403) {
    throw new PairRejectedError(
      'pairing code rejected — codes are one-time, expire after 10 minutes, and come ' +
        'from the worker dashboard. Generate a fresh one and retry.',
    );
  }
  if (!response.ok) {
    throw new WorkerApiError(
      `pairing failed: HTTP ${response.status} ${detail.slice(0, 200)}`.trim(),
      response.status,
    );
  }
  let body: { token?: unknown; deviceId?: unknown };
  try {
    body = JSON.parse(detail) as { token?: unknown; deviceId?: unknown };
  } catch {
    throw new WorkerApiError('pairing reply was not JSON', response.status);
  }
  if (typeof body.token !== 'string' || typeof body.deviceId !== 'string') {
    throw new WorkerApiError('pairing reply was missing token/deviceId', response.status);
  }
  return { token: body.token, deviceId: body.deviceId };
}

// --- device self-service (PATCH /device) -----------------------------------------------

/** The device document the worker returns from `PATCH /device`. */
export interface WorkerDevice {
  id: string;
  name: string;
  type: string;
}

export type RenameOutcome =
  | { ok: true; device: WorkerDevice }
  | { ok: false; error: string };

export interface RenameParams {
  origin: string;
  /** The calling device's own token — it can only ever rename itself. */
  token: string;
  name: string;
  fetchImpl: typeof fetch;
}

/**
 * `PATCH /device` — rename THIS device on the worker (device-token
 * authenticated; never throws: failures come back as `{ok:false, error}`).
 */
export async function renameDevice(params: RenameParams): Promise<RenameOutcome> {
  let response: Response;
  try {
    response = await params.fetchImpl(`${params.origin}/device`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${params.token}` },
      body: JSON.stringify({ name: params.name }),
    });
  } catch (error) {
    return {
      ok: false,
      error: `could not reach the worker at ${params.origin}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  const detail = (await response.text().catch(() => '')).trim();
  if (response.status === 421) {
    return { ok: false, error: 'this worker has not been claimed yet' };
  }
  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      error: 'the worker rejected this device\u2019s token (revoked?) — unlink and re-pair with a fresh code.',
    };
  }
  if (!response.ok) {
    let reason = `HTTP ${response.status}`;
    try {
      const parsed = JSON.parse(detail) as { error?: unknown };
      if (typeof parsed.error === 'string') reason = parsed.error;
    } catch {
      // keep the bare status
    }
    return { ok: false, error: reason };
  }
  let body: { device?: unknown };
  try {
    body = JSON.parse(detail) as { device?: unknown };
  } catch {
    return { ok: false, error: 'rename reply was not JSON' };
  }
  const device = body.device as Partial<WorkerDevice> | undefined;
  if (
    typeof device?.id !== 'string' ||
    typeof device.name !== 'string' ||
    typeof device.type !== 'string'
  ) {
    return { ok: false, error: 'rename reply was missing the device document' };
  }
  return { ok: true, device: { id: device.id, name: device.name, type: device.type } };
}

// --- worker status (GET /api/status, device token) --------------------------------------

/** The slice of `/api/status` the plugin's About section shows. */
export interface WorkerStatusSummary {
  vaultName: string;
  devices: Array<{ id: string; name: string; type: string; online: boolean; revoked: boolean }>;
  attachments: { count: number; bytes: number };
  storageBytes: number;
  /** Worker-reported release version (absent on servers ≤ 0.1). */
  serverVersion?: string;
}

/**
 * `GET /api/status` with the device token — storage usage + device list for
 * the About section. Resolves `null` on any failure (About shows "unknown").
 */
export async function fetchWorkerStatus(params: {
  origin: string;
  token: string;
  fetchImpl: typeof fetch;
}): Promise<WorkerStatusSummary | null> {
  let response: Response;
  try {
    response = await params.fetchImpl(`${params.origin}/api/status`, {
      headers: { authorization: `Bearer ${params.token}` },
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const body = (await response.json().catch(() => null)) as Partial<WorkerStatusSummary> | null;
  if (body === null || typeof body.storageBytes !== 'number' || typeof body.attachments !== 'object') {
    return null;
  }
  return {
    vaultName: typeof body.vaultName === 'string' ? body.vaultName : '',
    devices: Array.isArray(body.devices) ? body.devices : [],
    attachments: body.attachments,
    storageBytes: body.storageBytes,
    ...(typeof body.serverVersion === 'string' ? { serverVersion: body.serverVersion } : {}),
  };
}
