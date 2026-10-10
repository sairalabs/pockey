import { act, cleanup, renderHook } from '@testing-library/react';
import type { HostRequest, SessionSigner } from '@pockey/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PockeyEmbedError } from './errors.js';
import { useSessionSigners, type UseSessionSignersResult } from './hooks.js';
import {
  EVM_WALLET_ID,
  flush,
  makeUser,
  renderPockey,
  type FakeEmbed,
  type HarnessOptions,
} from './__tests__/fake-embed.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const sessionId = (fill: string) => `ses_${fill.repeat(24)}`;

function makeSession(fill: string, overrides: Partial<SessionSigner> = {}): SessionSigner {
  return {
    id: sessionId(fill),
    walletId: EVM_WALLET_ID,
    policy: { chain: 'evm', expiresIn: '7d', maxValuePerTx: '50000000000000000' },
    spentTotal: '0',
    expiresAt: '2026-09-24T12:00:00.000Z',
    revokedAt: null,
    createdAt: '2026-09-17T12:00:00.000Z',
    ...overrides,
  } as SessionSigner;
}

const OLDER = makeSession('a');
const NEWER = makeSession('b', { createdAt: '2026-09-17T13:00:00.000Z' });

function SessionsProbe({ history }: { history: UseSessionSignersResult[] }) {
  history.push(useSessionSigners());
  return null;
}

async function renderSessions(options: HarnessOptions & { consumers?: number } = {}) {
  const history: UseSessionSignersResult[] = [];
  const harness = await renderPockey({
    ...options,
    children: Array.from({ length: options.consumers ?? 1 }, (_, index) => (
      <SessionsProbe key={index} history={history} />
    )),
  });
  const sessions = () => {
    const latest = history.at(-1);
    if (!latest) throw new Error('SessionsProbe never rendered');
    return latest;
  };
  return { ...harness, sessions, sessionsHistory: history };
}

/** Answers `listSessions` with the given list. */
const listing =
  (sessions: SessionSigner[]) =>
  (embed: FakeEmbed): void => {
    embed.handle('listSessions', () => ({ data: { sessions } }));
  };

function requestOf<T extends HostRequest['type']>(
  embed: FakeEmbed,
  type: T,
): Extract<HostRequest, { type: T }> {
  return embed.last(type) as Extract<HostRequest, { type: T }>;
}

describe('useSessionSigners', () => {
  it('does not load while logged out', async () => {
    const { embed, sessions } = await renderSessions({ setup: listing([OLDER]) });
    await act(flush);
    expect(embed.requestsOf('listSessions')).toHaveLength(0);
    expect(sessions()).toMatchObject({ sessions: [], loading: false });
  });

  it('loads lazily once when authenticated, shared by every consumer', async () => {
    const { embed, sessions, sessionsHistory } = await renderSessions({
      consumers: 2,
      initUser: makeUser(),
      setup: (fake) => {
        fake.handle('listSessions', () => 'ignore');
      },
    });
    expect(embed.requestsOf('listSessions')).toHaveLength(1);
    expect(sessions()).toMatchObject({ sessions: [], loading: true });
    // Once the user is known, the list reads as loading until the answer, never as empty.
    const firstLoading = sessionsHistory.findIndex((value) => value.loading);
    expect(sessionsHistory.slice(firstLoading).every((value) => value.loading)).toBe(true);

    await act(async () => {
      embed.respond(requestOf(embed, 'listSessions').requestId, { sessions: [NEWER, OLDER] });
      await flush();
    });
    expect(sessions()).toMatchObject({ sessions: [NEWER, OLDER], loading: false });
    expect(embed.requestsOf('listSessions')).toHaveLength(1);
  });

  it('refresh refetches and keeps the result', async () => {
    const { embed, sessions } = await renderSessions({
      initUser: makeUser(),
      setup: listing([OLDER]),
    });
    await act(flush);
    embed.handle('listSessions', () => ({ data: { sessions: [NEWER, OLDER] } }));
    let refreshed: SessionSigner[] = [];
    await act(async () => {
      refreshed = await sessions().refresh();
    });
    expect(refreshed).toEqual([NEWER, OLDER]);
    expect(sessions().sessions).toEqual([NEWER, OLDER]);
    expect(embed.requestsOf('listSessions')).toHaveLength(2);
  });

  it('createSession sends the input and puts the new session first without a refetch', async () => {
    const { embed, sessions } = await renderSessions({
      initUser: makeUser(),
      setup: (fake) => {
        listing([OLDER])(fake);
        fake.handle('createSession', () => ({ data: NEWER }));
      },
    });
    await act(flush);
    const input = {
      walletId: EVM_WALLET_ID,
      policy: { chain: 'evm' as const, expiresIn: '7d', maxValuePerTx: '50000000000000000' },
    };

    let created: SessionSigner | null = null;
    await act(async () => {
      created = await sessions().createSession(input);
    });
    expect(created).toEqual(NEWER);
    expect(requestOf(embed, 'createSession').input).toEqual(input);
    expect(sessions().sessions).toEqual([NEWER, OLDER]);
    expect(embed.requestsOf('listSessions')).toHaveLength(1);
  });

  it('createSession rejects user_rejected and leaves the list alone', async () => {
    const { sessions } = await renderSessions({
      initUser: makeUser(),
      setup: (fake) => {
        listing([OLDER])(fake);
        fake.handle('createSession', () => ({
          error: { code: 'user_rejected', message: 'The user rejected the request.' },
        }));
      },
    });
    await act(flush);
    const error: unknown = await sessions()
      .createSession({ walletId: EVM_WALLET_ID, policy: { chain: 'evm', expiresIn: '1h' } })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'user_rejected' });
    expect(sessions().sessions).toEqual([OLDER]);
  });

  it('a session created while the first load is in flight survives the load', async () => {
    const { embed, sessions } = await renderSessions({
      initUser: makeUser(),
      setup: (fake) => {
        fake.handle('listSessions', () => 'ignore');
        fake.handle('createSession', () => ({ data: NEWER }));
      },
    });
    await act(async () => {
      await sessions().createSession({
        walletId: EVM_WALLET_ID,
        policy: { chain: 'evm', expiresIn: '7d' },
      });
    });
    await act(async () => {
      embed.respond(requestOf(embed, 'listSessions').requestId, { sessions: [OLDER] });
      await flush();
    });
    expect(sessions().sessions).toEqual([NEWER, OLDER]);
  });

  it('revokeSession marks the session revoked without a refetch', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-18T08:00:00.000Z'));
    const { embed, sessions } = await renderSessions({
      initUser: makeUser(),
      setup: (fake) => {
        listing([NEWER, OLDER])(fake);
        fake.handle('revokeSession', () => ({ data: { ok: true } }));
      },
    });
    await act(flush);

    await act(async () => {
      await sessions().revokeSession(OLDER.id);
    });
    expect(requestOf(embed, 'revokeSession').sessionId).toBe(OLDER.id);
    expect(sessions().sessions).toEqual([
      NEWER,
      { ...OLDER, revokedAt: '2026-09-18T08:00:00.000Z' },
    ]);
    expect(embed.requestsOf('listSessions')).toHaveLength(1);
  });

  it('clears on logout and loads again for the next login', async () => {
    const user = makeUser();
    const { embed, sessions } = await renderSessions({
      initUser: user,
      setup: (fake) => {
        listing([OLDER])(fake);
        fake.handle('login', () => ({ data: { user } }));
      },
    });
    await act(flush);
    expect(sessions().sessions).toEqual([OLDER]);

    act(() => {
      embed.send({ type: 'authChanged', user: null });
    });
    expect(sessions()).toMatchObject({ sessions: [], loading: false });
    await expect(sessions().refresh()).rejects.toMatchObject({ code: 'not_authenticated' });

    embed.handle('listSessions', () => ({ data: { sessions: [NEWER] } }));
    await act(async () => {
      embed.send({ type: 'authChanged', user });
      await flush();
    });
    expect(sessions().sessions).toEqual([NEWER]);
    expect(embed.requestsOf('listSessions')).toHaveLength(2);
  });

  it('drops a load that finishes after logout', async () => {
    const { embed, sessions } = await renderSessions({
      initUser: makeUser(),
      setup: (fake) => {
        fake.handle('listSessions', () => 'ignore');
      },
    });
    const { requestId } = requestOf(embed, 'listSessions');
    act(() => {
      embed.send({ type: 'authChanged', user: null });
    });
    await act(async () => {
      embed.respond(requestId, { sessions: [OLDER] });
      await flush();
    });
    expect(sessions()).toMatchObject({ sessions: [], loading: false });
  });

  it('signWithSession passes the request through without touching the list', async () => {
    const { embed, sessions } = await renderSessions({
      initUser: makeUser(),
      setup: (fake) => {
        listing([OLDER])(fake);
        fake.handle('signWithSession', () => ({ data: { hash: '0xhash', sponsored: true } }));
      },
    });
    await act(flush);
    const request = {
      kind: 'transaction' as const,
      input: {
        chain: 'evm' as const,
        chainId: 8453 as const,
        to: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
        value: '1',
      },
      sponsored: true,
    };
    await expect(sessions().signWithSession(OLDER.id, request)).resolves.toEqual({
      hash: '0xhash',
      sponsored: true,
    });
    expect(requestOf(embed, 'signWithSession')).toMatchObject({
      sessionId: OLDER.id,
      request: { ...request, broadcast: true },
    });
    expect(sessions().sessions).toEqual([OLDER]);
  });

  it('signWithSession maps a policy refusal to policy_violation with its reason', async () => {
    const { sessions } = await renderSessions({
      initUser: makeUser(),
      setup: (fake) => {
        listing([OLDER])(fake);
        fake.handle('signWithSession', () => ({
          error: {
            code: 'policy_violation',
            message: 'Above the per transaction limit.',
            reason: 'value_per_tx_exceeded',
          },
        }));
      },
    });
    await act(flush);
    const error: unknown = await sessions()
      .signWithSession(OLDER.id, { kind: 'message', input: { chain: 'evm', message: 'gm' } })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PockeyEmbedError);
    expect(error).toMatchObject({
      code: 'policy_violation',
      message: 'Above the per transaction limit.',
      reason: 'value_per_tx_exceeded',
    });
  });

  it('rejects not_authenticated without posting when logged out', async () => {
    const { embed, sessions } = await renderSessions();
    const actions = sessions();
    for (const call of [
      () =>
        actions.createSession({
          walletId: EVM_WALLET_ID,
          policy: { chain: 'evm', expiresIn: '1h' },
        }),
      () => actions.revokeSession(OLDER.id),
      () =>
        actions.signWithSession(OLDER.id, {
          kind: 'message',
          input: { chain: 'evm', message: 'gm' },
        }),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: 'not_authenticated' });
    }
    expect(
      embed.received.filter((request) => request.type !== 'init').map((request) => request.type),
    ).toEqual([]);
  });

  it('keeps function identities stable so they can be destructured', async () => {
    const { sessions, sessionsHistory } = await renderSessions({
      initUser: makeUser(),
      setup: listing([OLDER]),
    });
    await act(flush);
    const first = sessionsHistory[0];
    const { createSession, revokeSession, signWithSession, refresh } = sessions();
    expect(createSession).toBe(first?.createSession);
    expect(revokeSession).toBe(first?.revokeSession);
    expect(signWithSession).toBe(first?.signWithSession);
    expect(refresh).toBe(first?.refresh);
  });

  it('throws a clear error outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderHook(() => useSessionSigners())).toThrow(
      'useSessionSigners() must be used inside <PockeyProvider>.',
    );
  });
});
