/**
 * Device-token rotation on the real DO: past the 90-day interval, a hello
 * re-issues the token (`nextToken` in the ack); the previous token survives
 * the 24 h grace, then authentication refuses it.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { claim, hello, resetAll, setRoomTime, WsClient } from './helpers.js';
import type { HelloAckMessage, ServerMessage } from '@vsa/core';

beforeEach(async () => {
  await resetAll();
});

describe('token rotation (DO)', () => {
  it('re-issues an aged token on hello; the old token survives grace, then dies', async () => {
    const { token: deviceToken } = await claim({ passphrase: 'pppppppp', vaultName: 'personal' });

    // Fresh token: no rotation for a while.
    const ws1 = await WsClient.connect();
    const ack1 = (await hello(ws1, deviceToken)) as HelloAckMessage;
    expect(ack1.type).toBe('helloAck');
    expect(ack1.nextToken).toBeUndefined();
    ws1.close();

    // 91 days later: the hello rotates and hands the replacement over.
    setRoomTime(Date.now() + 91 * 24 * 60 * 60 * 1000);
    const ws2 = await WsClient.connect();
    const reply = ws2.next((m) => m.type === 'helloAck' || m.type === 'error');
    ws2.send({ type: 'hello', token: deviceToken, protocolVersion: 1, cursor: 0 });
    const ack2 = (await reply) as ServerMessage & { nextToken?: string };
    expect(ack2.type).toBe('helloAck');
    expect(typeof ack2.nextToken).toBe('string');
    const nextToken = ack2.nextToken as string;
    expect(nextToken).not.toBe(deviceToken);
    ws2.close();

    // Grace: the OLD token still authenticates (one more successful hello) —
    // and its ack carries ANOTHER hand-off, superseding the previous one
    // (exactly what a client persisting every nextToken ends up holding).
    const ws3 = await WsClient.connect();
    const ack3 = (await hello(ws3, deviceToken)) as HelloAckMessage & { nextToken?: string };
    expect(ack3.type).toBe('helloAck');
    const currentToken = ack3.nextToken ?? nextToken;
    ws3.close();

    // After 25 more hours the old tokens are dead; the latest hand-off lives.
    setRoomTime(Date.now() + 91 * 24 * 60 * 60 * 1000 + 25 * 60 * 60 * 1000);
    const ws4 = await WsClient.connect();
    const oldReply = ws4.next((m) => m.type === 'helloAck' || m.type === 'error');
    ws4.send({ type: 'hello', token: deviceToken, protocolVersion: 1, cursor: 0 });
    const refused = (await oldReply) as ServerMessage;
    expect(refused.type).toBe('error');
    ws4.close();

    const ws5 = await WsClient.connect();
    const kept = (await hello(ws5, currentToken)) as HelloAckMessage;
    expect(kept.type).toBe('helloAck');
    ws5.close();
  });
});
