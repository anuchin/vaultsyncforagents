/**
 * Minimal typed client for the worker's HTTP surface as the plugin uses it:
 * `GET /health` (claim-state probe before pairing) and `POST /pair` (redeem a
 * pairing code, ARCHITECTURE §3). Built on an injectable `fetch`; failures
 * map to typed errors with actionable messages so the settings UI and the
 * deep-link handler never see a raw `TypeError: Failed to fetch`.
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
