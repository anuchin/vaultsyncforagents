/**
 * Typed error hierarchy shared by all clients (plugin, daemon, CLI) and the
 * test-suite server. Errors carry a stable machine-readable `code`.
 */

export type ErrorCode =
  | 'UNCLAIMED'
  | 'UNAUTHORIZED'
  | 'REVOKED'
  | 'CONFLICT'
  | 'PROTOCOL'
  | 'NETWORK';

/** Base class for all VaultSync errors. */
export abstract class VaultSyncError extends Error {
  abstract readonly code: ErrorCode;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Worker exists but has not been claimed yet (HTTP 421 on every API call). */
export class UnclaimedError extends VaultSyncError {
  readonly code = 'UNCLAIMED' as const;
}

/** Token missing, invalid, or not accepted (HTTP 401 class). */
export class UnauthorizedError extends VaultSyncError {
  readonly code = 'UNAUTHORIZED' as const;
}

/** The device token was revoked; the device must be re-paired. */
export class RevokedError extends VaultSyncError {
  readonly code = 'REVOKED' as const;
}

/** A commit raced with a concurrent edit; the server arbitrated (see §4). */
export class ConflictError extends VaultSyncError {
  readonly code = 'CONFLICT' as const;
}

/** A peer (or local bug) violated the protocol: bad message shape, bad version. */
export class ProtocolError extends VaultSyncError {
  readonly code = 'PROTOCOL' as const;
}

/** Transport-level failure: socket closed, fetch refused, timeout. Retriable. */
export class NetworkError extends VaultSyncError {
  readonly code = 'NETWORK' as const;
}
