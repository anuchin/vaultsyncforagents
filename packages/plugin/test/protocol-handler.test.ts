import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parsePairDeepLink,
  registerPairProtocolHandler,
  PROTOCOL_ACTION,
} from '../src/protocol-handler.js';
import {
  Notice,
  protocolHandlers,
  registerObsidianProtocolHandler,
  resetObsidianMock,
} from './helpers/obsidian-mock.js';

describe('parsePairDeepLink', () => {
  it('extracts url and code', () => {
    expect(
      parsePairDeepLink({ action: 'pair', url: 'https://w.example', code: '7F3K-Q9M2' }),
    ).toEqual({ ok: true, link: { url: 'https://w.example', code: '7F3K-Q9M2' } });
  });

  it('decodes percent-encoded values once (over-eager link generators)', () => {
    expect(
      parsePairDeepLink({
        url: 'https%3A%2F%2Fw.example',
        code: 'ABCD-EFGH',
      }),
    ).toEqual({ ok: true, link: { url: 'https://w.example', code: 'ABCD-EFGH' } });
  });

  it('trims whitespace and coerces numeric params', () => {
    expect(parsePairDeepLink({ url: ' https://w.example ', code: 1234 })).toEqual({
      ok: true,
      link: { url: 'https://w.example', code: '1234' },
    });
  });

  it('errors when either half is missing', () => {
    expect(parsePairDeepLink({ url: 'https://w.example' }).ok).toBe(false);
    expect(parsePairDeepLink({ code: 'X' }).ok).toBe(false);
    expect(parsePairDeepLink({}).ok).toBe(false);
  });
});

describe('registerPairProtocolHandler', () => {
  beforeEach(() => {
    resetObsidianMock();
  });

  it('registers both action spellings (host and host/path)', () => {
    registerPairProtocolHandler(registerObsidianProtocolHandler, vi.fn());
    expect(Object.keys(protocolHandlers).sort()).toEqual([
      PROTOCOL_ACTION,
      `${PROTOCOL_ACTION}/pair`,
    ]);
  });

  it('invokes the pair callback with the parsed link', async () => {
    const onPair = vi.fn().mockResolvedValue(undefined);
    registerPairProtocolHandler(registerObsidianProtocolHandler, onPair);

    protocolHandlers[PROTOCOL_ACTION]!({ url: 'https://w.example', code: 'AA-BB' });
    await vi.waitFor(() => expect(onPair).toHaveBeenCalled());
    expect(onPair).toHaveBeenCalledWith({ url: 'https://w.example', code: 'AA-BB' });
  });

  it('malformed link (one param) → error Notice, no pair attempt', () => {
    const onPair = vi.fn().mockResolvedValue(undefined);
    registerPairProtocolHandler(registerObsidianProtocolHandler, onPair);

    protocolHandlers[`${PROTOCOL_ACTION}/pair`]!({ url: 'https://w.example' });
    expect(onPair).not.toHaveBeenCalled();
    expect(Notice.messages).toHaveLength(1);
    expect(Notice.messages[0]!.message).toContain('missing the pairing code');
  });

  it('bare action hit (no params) stays silent', () => {
    const onPair = vi.fn().mockResolvedValue(undefined);
    registerPairProtocolHandler(registerObsidianProtocolHandler, onPair);

    protocolHandlers[PROTOCOL_ACTION]!({ action: PROTOCOL_ACTION });
    expect(onPair).not.toHaveBeenCalled();
    expect(Notice.messages).toHaveLength(0);
  });

  it('callback rejection is logged, not fatal', async () => {
    const onPair = vi.fn().mockRejectedValue(new Error('boom'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    registerPairProtocolHandler(registerObsidianProtocolHandler, onPair);

    protocolHandlers[PROTOCOL_ACTION]!({ url: 'https://w.example', code: 'X' });
    await vi.waitFor(() => expect(onPair).toHaveBeenCalled());
    // The rejection handler logs and posts a Notice instead of throwing.
    expect(Notice.messages.some((n) => n.message.includes('link failed'))).toBe(true);
    errorSpy.mockRestore();
  });
});
