/**
 * §14 path-safety admission gate on the REAL Durable Object: a commit that
 * would create a NEW live path under an occupied fold key (NFC + case fold)
 * is refused with `PATH_COLLIDES` — without tripping the protocol-error
 * disconnect — while edits to existing heads keep flowing. Non-NFC paths are
 * refused by the canonicality shape gate.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { CommitAckMessage, ServerMessage } from '@vsa/core';
import { b64, claim, hashOf, hello, resetAll, WsClient, enc } from './helpers.js';

async function commitInline(
  ws: WsClient,
  path: string,
  parent: string | null,
  content: string,
  kind: 'edit' | 'delete' | 'rename' = 'edit',
  fromPath?: string,
): Promise<ServerMessage> {
  const bytes = enc(content);
  const hash = kind === 'delete' ? (await hashOf(enc(content))) : await hashOf(bytes);
  const reply = ws.next((m) => m.type === 'commitAck' || m.type === 'conflict' || m.type === 'error');
  ws.send({
    type: 'commit',
    path,
    parentVersion: parent,
    hash,
    size: bytes.byteLength,
    kind,
    ...(fromPath !== undefined ? { fromPath } : {}),
    ...(kind === 'delete' ? {} : { inline: b64(bytes) }),
  });
  return (await reply) as ServerMessage;
}

beforeEach(async () => {
  await resetAll();
});

describe('§14 path-safety admission gate', () => {
  it('refuses a case-colliding NEW path with PATH_COLLIDES, keeps the socket, lets edits flow', async () => {
    const { token } = await claim({ passphrase: 'pppppppp', vaultName: 'personal' });
    const ws = await WsClient.connect();
    await hello(ws, token);

    const first = (await commitInline(ws, '/notes/Note.md', null, 'v1')) as CommitAckMessage;
    expect(first.type).toBe('commitAck');

    // The case twin is refused — its own code, not a generic protocol error.
    const refusal = await commitInline(ws, '/notes/NOTE.md', null, 'twin');
    expect(refusal.type).toBe('error');
    if (refusal.type === 'error') {
      expect(refusal.code).toBe('PATH_COLLIDES');
      expect(refusal.message).toContain('/notes/Note.md');
    }

    // NOT a protocol violation: the socket stays open and further commits
    // (edits to the existing head, unrelated new paths) flow normally.
    expect(ws.closed).toBe(false);
    const edit = (await commitInline(ws, '/notes/Note.md', first.version, 'v2')) as CommitAckMessage;
    expect(edit.type).toBe('commitAck');
    const fresh = await commitInline(ws, '/other.md', null, 'unrelated');
    expect(fresh.type).toBe('commitAck');
    ws.close();
  });

  it('a case-only RENAME is exempt (the source row frees its own fold key)', async () => {
    const { token } = await claim({ passphrase: 'pppppppp', vaultName: 'personal' });
    const ws = await WsClient.connect();
    await hello(ws, token);

    const first = (await commitInline(ws, '/notes/Note.md', null, 'stable')) as CommitAckMessage;
    const rename = await commitInline(ws, '/notes/NOTE.md', first.version, 'stable', 'rename', '/notes/Note.md');
    expect(rename.type).toBe('commitAck');
    ws.close();
  });

  it('refuses a canonically-equivalent twin (NFC vs NFD) as non-canonical PROTOCOL', async () => {
    const { token } = await claim({ passphrase: 'pppppppp', vaultName: 'personal' });
    const ws = await WsClient.connect();
    await hello(ws, token);

    const first = (await commitInline(ws, '/caf\u00e9.md', null, 'nfc form')) as CommitAckMessage;
    expect(first.type).toBe('commitAck');

    // NFD form of the same name: the canonicality shape gate rejects it
    // (this IS the protocol violation class — counted as such).
    const refusal = await commitInline(ws, '/cafe\u0301.md', null, 'nfd form');
    expect(refusal).toMatchObject({ type: 'error', code: 'PROTOCOL' });
    ws.close();
  });
});
