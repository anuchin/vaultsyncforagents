import { describe, expect, it } from 'vitest';

import {
  ConflictError,
  NetworkError,
  ProtocolError,
  RevokedError,
  UnauthorizedError,
  UnclaimedError,
  VaultSyncError,
} from '../src/index.js';

describe('error hierarchy', () => {
  it('every error extends VaultSyncError and Error', () => {
    const errors = [
      new UnclaimedError('worker not claimed'),
      new UnauthorizedError('bad token'),
      new RevokedError('device revoked'),
      new ConflictError('parent diverged'),
      new ProtocolError('unknown message'),
      new NetworkError('socket closed'),
    ];
    for (const error of errors) {
      expect(error).toBeInstanceOf(VaultSyncError);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).not.toBe('');
    }
  });

  it('carries stable codes and subclass names', () => {
    expect(new UnclaimedError('x')).toMatchObject({ code: 'UNCLAIMED', name: 'UnclaimedError' });
    expect(new UnauthorizedError('x')).toMatchObject({ code: 'UNAUTHORIZED', name: 'UnauthorizedError' });
    expect(new RevokedError('x')).toMatchObject({ code: 'REVOKED', name: 'RevokedError' });
    expect(new ConflictError('x')).toMatchObject({ code: 'CONFLICT', name: 'ConflictError' });
    expect(new ProtocolError('x')).toMatchObject({ code: 'PROTOCOL', name: 'ProtocolError' });
    expect(new NetworkError('x')).toMatchObject({ code: 'NETWORK', name: 'NetworkError' });
  });

  it('supports ErrorOptions.cause', () => {
    const cause = new Error('underlying');
    const error: VaultSyncError = new NetworkError('retry failed', { cause });
    expect(error.cause).toBe(cause);
  });
});
