/**
 * `HttpBlobStore` — core's `BlobStore` against the worker's `/blob/:hash`
 * routes (ARCHITECTURE §5 HTTPS routes), authenticated with the device token
 * as a Bearer header. Built on the global `fetch` (Obsidian desktop and
 * mobile), injectable for tests. Plugin-local twin of the node-runtime one:
 * no imports from `@vsa/node-runtime` (Node-only package).
 */

import type { BlobStore } from '@vsa/core';

/** Non-2xx blob-route reply. `status` is the HTTP status code. */
export class HttpBlobError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpBlobError';
  }
}

export interface HttpBlobStoreOptions {
  /** Worker origin, e.g. `https://personal.x.workers.dev`. */
  baseUrl: string;
  /** Device token (Bearer). */
  token: string;
  /** Injectable fetch (tests). Defaults to the global. */
  fetchImpl?: typeof fetch;
}

export class HttpBlobStore implements BlobStore {
  private readonly base: string;
  private readonly token: string;
  private readonly doFetch: typeof fetch;

  constructor(options: HttpBlobStoreOptions) {
    this.base = options.baseUrl.replace(/\/+$/, '');
    this.token = options.token;
    this.doFetch = options.fetchImpl ?? fetch;
  }

  /** GET /blob/:hash → bytes, or `undefined` on 404. */
  async get(hash: string): Promise<Uint8Array | undefined> {
    const response = await this.doFetch(`${this.base}/blob/${hash}`, {
      headers: { authorization: `Bearer ${this.token}` },
    });
    if (response.status === 404) return undefined;
    if (!response.ok) {
      throw new HttpBlobError(response.status, await errorMessage(response, 'fetch blob'));
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  /** PUT /blob/:hash — idempotent per the CAS contract. */
  async put(hash: string, bytes: Uint8Array): Promise<void> {
    const response = await this.doFetch(`${this.base}/blob/${hash}`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/octet-stream',
      },
      body: bytes as BodyInit,
    });
    if (!response.ok) {
      throw new HttpBlobError(response.status, await errorMessage(response, 'store blob'));
    }
  }
}

async function errorMessage(response: Response, what: string): Promise<string> {
  const detail = (await response.text().catch(() => '')).slice(0, 300);
  return detail === ''
    ? `failed to ${what}: HTTP ${response.status}`
    : `failed to ${what}: HTTP ${response.status}: ${detail}`;
}
