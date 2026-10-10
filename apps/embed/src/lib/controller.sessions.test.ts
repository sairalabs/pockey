import { PockeyError } from '@pockey/core';
import {
  EndUser,
  HostRequest,
  PublicAppConfig,
  SessionSigner,
  type SigningPolicy,
} from '@pockey/types';
import { describe, expect, it, vi } from 'vitest';
import { createController, type EmbedClient } from './controller';
import { toEmbedError } from './errors';
import { createEmbedStore, isScreen } from './state';

const HOST = 'https://app.example';
const NOW = Date.parse('2026-09-17T10:00:00.000Z');

const serverConfig = PublicAppConfig.parse({
  appId: 'pk_app_a1b2c3d4e5f6g7h8i9j0k1l2',
  name: 'Playground',
  loginMethods: ['email'],
  chains: { evm: [8453], solana: [] },
  appearance: { theme: 'dark', accent: '#0052ff' },
  embeddedWallets: { createOnLogin: 'all' },
  allowedOrigins: [HOST],
  keyProvider: {
    kind: 'emulator',
    organizationId: 'org-parent',
    signerPublicKey: '02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  },
});

const user = EndUser.parse({
  id: 'usr_a1b2c3d4e5f6g7h8i9j0k1l2',
  appId: 'app_a1b2c3d4e5f6g7h8i9j0k1l2',
  identities: [],
  wallets: [
    {
      id: 'wlt_a1b2c3d4e5f6g7h8i9j0k1l2',
      endUserId: 'usr_a1b2c3d4e5f6g7h8i9j0k1l2',
      chainFamily: 'evm',
      address: '0x4bF0c1A3e7D2b5F6a8C9d0E1f2A3b4C5d6E7F711',
      smartAccountAddress: null,
      createdAt: '2026-09-16T10:00:00.000Z',
    },
  ],
  createdAt: '2026-09-16T10:00:00.000Z',
  lastActiveAt: null,
});
const walletId = user.wallets[0]?.id ?? '';
const SESSION_ID = 'ses_a1b2c3d4e5f6g7h8i9j0k1l2';

const policy = {
  chain: 'evm',
  expiresIn: '7d',
  maxValuePerTx: '50000000000000000',
  allowedChains: [8453],
} as const;

const signer = SessionSigner.parse({
  id: SESSION_ID,
  walletId,
  policy,
  spentTotal: '0',
  expiresAt: '2026-09-24T10:00:00.000Z',
  revokedAt: null,
  createdAt: '2026-09-17T10:00:00.000Z',
});

function setup(options: { signedIn: boolean }) {
  let current: EndUser | null = options.signedIn ? user : null;
  const sessions = {
    create: vi.fn(async () => signer),
    list: vi.fn(async () => [signer]),
    revoke: vi.fn(async () => undefined),
    sign: vi.fn(async () => ({ signature: '0xsession', sponsored: false })),
    isActive: vi.fn(() => true),
  };
  const signMessage = vi.fn(async () => ({ signature: '0xsigned' }));
  const client = {
    ready: vi.fn(async () => current),
    getConfig: vi.fn(async () => serverConfig),
    auth: {
      isAuthenticated: () => current !== null,
      getUser: () => current,
      refreshUser: vi.fn(async () => current),
      logout: vi.fn(async () => {
        current = null;
      }),
    },
    wallets: { signMessage },
    sessions,
  } as unknown as EmbedClient;
  const store = createEmbedStore();
  const controller = createController({
    client,
    store,
    location: { host: 'embed.test', origin: 'https://embed.test' },
    isKeyboard: () => false,
    successDelayMs: 0,
    now: () => NOW,
  });
  const handle = (raw: Record<string, unknown>) => {
    const message = { source: 'pockey', pk: 1, requestId: 'r', ...raw };
    return controller.handle(HostRequest.parse(message), { origin: HOST, raw: message });
  };
  return { store, controller, handle, sessions, signMessage };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const createRequest = (overrides: { walletId?: string; policy?: Partial<SigningPolicy> } = {}) => ({
  type: 'createSession',
  input: { walletId: overrides.walletId ?? walletId, policy: { ...policy, ...overrides.policy } },
});

const signWithSession = {
  type: 'signWithSession',
  sessionId: SESSION_ID,
  request: { kind: 'message', input: { chain: 'evm', message: 'gm' } },
};

describe('createSession', () => {
  it('shows the consent screen and creates the session on allow', async () => {
    const { handle, store, controller, sessions } = setup({ signedIn: true });
    const pending = handle(createRequest());
    await flush();

    const { screen, phase } = store.get();
    expect(phase).toBe('open');
    expect(isScreen(screen, 'session')).toBe(true);
    expect(screen).toMatchObject({
      name: 'session',
      origin: HOST,
      wallet: { id: walletId },
      policy,
      expiresAt: NOW + 7 * 86_400_000,
      status: 'idle',
      error: null,
    });
    expect(sessions.create).not.toHaveBeenCalled();

    controller.actions.approve();
    await expect(pending).resolves.toEqual(signer);
    expect(sessions.create).toHaveBeenCalledWith({ walletId, policy });
    expect(store.get().phase).toBe('closing');
  });

  it('rejects user_rejected on deny, Escape or backdrop, without creating anything', async () => {
    const { handle, controller, sessions } = setup({ signedIn: true });
    const denied = handle(createRequest());
    await flush();
    controller.actions.cancel();
    await expect(denied).rejects.toMatchObject({ code: 'user_rejected' });

    const dismissed = handle(createRequest());
    await flush();
    controller.actions.dismiss();
    await expect(dismissed).rejects.toMatchObject({ code: 'user_rejected' });
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('shows an API error inline and succeeds on try again', async () => {
    const { handle, store, controller, sessions } = setup({ signedIn: true });
    sessions.create.mockRejectedValueOnce(
      new PockeyError('key_provider_error', 'The key provider is unavailable.'),
    );
    const pending = handle(createRequest());
    await flush();
    controller.actions.approve();
    await flush();

    expect(store.get().phase).toBe('open');
    expect(store.get().screen).toMatchObject({
      name: 'session',
      status: 'error',
      error: { code: 'key_provider_error', message: 'The key provider is unavailable.' },
    });

    controller.actions.approve();
    await expect(pending).resolves.toEqual(signer);
    expect(sessions.create).toHaveBeenCalledTimes(2);
  });

  it('rejects not_authenticated when logged out, without UI', async () => {
    const { handle, store } = setup({ signedIn: false });
    await expect(handle(createRequest())).rejects.toMatchObject({ code: 'not_authenticated' });
    expect(store.get().phase).toBe('closed');
  });

  it('rejects wallet_not_found for a wallet the user does not own', async () => {
    const { handle, store } = setup({ signedIn: true });
    await expect(
      handle(createRequest({ walletId: 'wlt_zzzzzzzzzzzzzzzzzzzzzzzz' })),
    ).rejects.toMatchObject({ code: 'wallet_not_found' });
    expect(store.get().phase).toBe('closed');
  });

  it('rejects unsupported when the policy chain differs from the wallet family', async () => {
    const { handle, store, sessions } = setup({ signedIn: true });
    await expect(
      handle(
        createRequest({
          policy: { chain: 'solana', expiresIn: '2h', allowedChains: undefined },
        }),
      ),
    ).rejects.toMatchObject({ code: 'unsupported' });
    expect(store.get().phase).toBe('closed');
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('waits for a pending confirmation before showing consent', async () => {
    const { handle, store, controller } = setup({ signedIn: true });
    const sign = handle({
      type: 'signMessage',
      walletId,
      input: { chain: 'evm', message: 'first' },
    });
    const consent = handle(createRequest());
    await flush();
    expect(store.get().screen?.name).toBe('signMessage');

    controller.actions.approve();
    await expect(sign).resolves.toEqual({ signature: '0xsigned' });
    await flush();
    expect(store.get().screen?.name).toBe('session');
    controller.actions.cancel();
    await expect(consent).rejects.toMatchObject({ code: 'user_rejected' });
  });

  it('rejects not_authenticated when the user logs out during consent', async () => {
    const { handle } = setup({ signedIn: true });
    const consent = handle(createRequest());
    await flush();
    await handle({ type: 'logout' });
    await expect(consent).rejects.toMatchObject({ code: 'not_authenticated' });
  });
});

describe('session requests without UI', () => {
  it('listSessions and revokeSession call the client directly', async () => {
    const { handle, store, sessions } = setup({ signedIn: true });
    await expect(handle({ type: 'listSessions' })).resolves.toEqual({ sessions: [signer] });
    await expect(handle({ type: 'revokeSession', sessionId: SESSION_ID })).resolves.toEqual({
      ok: true,
    });
    expect(sessions.revoke).toHaveBeenCalledWith(SESSION_ID);
    expect(store.get().phase).toBe('closed');
    expect(store.get().screen).toBeNull();
  });

  it('signWithSession never opens a screen, even while consent is showing', async () => {
    const { handle, store, controller, sessions } = setup({ signedIn: true });
    await expect(handle(signWithSession)).resolves.toEqual({
      signature: '0xsession',
      sponsored: false,
    });
    expect(sessions.sign).toHaveBeenCalledWith(SESSION_ID, {
      kind: 'message',
      input: { chain: 'evm', message: 'gm' },
    });
    expect(store.get().phase).toBe('closed');
    expect(store.get().screen).toBeNull();

    const consent = handle(createRequest());
    await flush();
    const key = store.get().nav.key;
    await expect(handle(signWithSession)).resolves.toMatchObject({ signature: '0xsession' });
    expect(store.get().nav.key).toBe(key);
    expect(store.get().screen?.name).toBe('session');
    controller.actions.dismiss();
    await expect(consent).rejects.toMatchObject({ code: 'user_rejected' });
  });

  it('signWithSession relays a policy refusal with its reason', async () => {
    const { handle, store, sessions } = setup({ signedIn: true });
    sessions.sign.mockRejectedValueOnce(
      new PockeyError('policy_violation', 'Above the per transaction limit.', {
        status: 403,
        details: { reason: 'value_per_tx_exceeded' },
      }),
    );
    const error = await handle(signWithSession).then(
      () => null,
      (e: unknown) => e,
    );
    expect(toEmbedError(error)).toEqual({
      code: 'policy_violation',
      message: 'Above the per transaction limit.',
      reason: 'value_per_tx_exceeded',
    });
    expect(store.get().phase).toBe('closed');
  });
});
