import { PockeyError } from '@pockey/core';
import { EndUser, HostRequest, PublicAppConfig } from '@pockey/types';
import { describe, expect, it, vi } from 'vitest';
import { narrowLoginMethods } from './config';
import { createController, type EmbedClient } from './controller';
import { createEmbedStore } from './state';

const HOST = 'https://app.example';

const serverConfig = PublicAppConfig.parse({
  appId: 'pk_app_a1b2c3d4e5f6g7h8i9j0k1l2',
  name: 'Playground',
  loginMethods: ['email', 'google', 'passkey'],
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

function setup(options: { signedIn: boolean }) {
  let current: EndUser | null = options.signedIn ? user : null;
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
  } as unknown as EmbedClient;
  const store = createEmbedStore();
  const controller = createController({
    client,
    store,
    location: { host: 'embed.test', origin: 'https://embed.test' },
    isKeyboard: () => false,
    successDelayMs: 0,
  });
  const handle = (raw: Record<string, unknown>) => {
    const message = { source: 'pockey', pk: 1, requestId: 'r', ...raw };
    return controller.handle(HostRequest.parse(message), { origin: HOST, raw: message });
  };
  return { client, store, controller, handle, signMessage };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const signRequest = (extra: Record<string, unknown> = {}) => ({
  type: 'signMessage',
  walletId,
  input: { chain: 'evm', message: 'gm from the Pockey playground' },
  ...extra,
});

describe('controller', () => {
  it('resolves login at once, without opening the dialog, when already signed in', async () => {
    const { handle, store } = setup({ signedIn: true });
    await expect(handle({ type: 'login' })).resolves.toEqual({ user });
    expect(store.get().phase).toBe('closed');
    expect(store.get().screen).toBeNull();
  });

  it('opens the login screen when signed out and rejects user_rejected on dismiss', async () => {
    const { handle, store, controller } = setup({ signedIn: false });
    const pending = handle({ type: 'login' });
    await flush();
    expect(store.get().phase).toBe('open');
    expect(store.get().screen?.name).toBe('login');
    controller.actions.dismiss();
    await expect(pending).rejects.toMatchObject({ code: 'user_rejected' });
    expect(store.get().phase).toBe('closing');
  });

  it('signs directly with confirm false', async () => {
    const { handle, store, signMessage } = setup({ signedIn: true });
    await expect(handle(signRequest({ confirm: false }))).resolves.toEqual({
      signature: '0xsigned',
    });
    expect(signMessage).toHaveBeenCalledWith(walletId, {
      chain: 'evm',
      message: 'gm from the Pockey playground',
    });
    expect(store.get().phase).toBe('closed');
  });

  it('shows the confirmation screen and signs on approve', async () => {
    const { handle, store, controller, signMessage } = setup({ signedIn: true });
    const pending = handle(signRequest());
    await flush();
    expect(store.get().screen?.name).toBe('signMessage');
    expect(signMessage).not.toHaveBeenCalled();
    controller.actions.approve();
    await expect(pending).resolves.toEqual({ signature: '0xsigned' });
  });

  it('rejects user_rejected on cancel, and the original code after an API error', async () => {
    const { handle, controller, signMessage } = setup({ signedIn: true });
    const first = handle(signRequest());
    await flush();
    controller.actions.cancel();
    await expect(first).rejects.toMatchObject({ code: 'user_rejected' });

    signMessage.mockRejectedValueOnce(new PockeyError('policy_violation', 'Blocked by policy'));
    const second = handle(signRequest());
    await flush();
    controller.actions.approve();
    await flush();
    controller.actions.cancel();
    await expect(second).rejects.toMatchObject({ code: 'policy_violation' });
  });

  it('rejects wallet_not_found for a wallet the user does not own', async () => {
    const { handle } = setup({ signedIn: true });
    await expect(
      handle(signRequest({ walletId: 'wlt_zzzzzzzzzzzzzzzzzzzzzzzz' })),
    ).rejects.toMatchObject({ code: 'wallet_not_found' });
  });

  it('rejects not_authenticated when logged out', async () => {
    const { handle } = setup({ signedIn: false });
    await expect(handle(signRequest())).rejects.toMatchObject({ code: 'not_authenticated' });
    await expect(handle(signRequest({ confirm: false }))).rejects.toMatchObject({
      code: 'not_authenticated',
    });
  });

  it('serializes interactive requests', async () => {
    const { handle, store, controller } = setup({ signedIn: true });
    const first = handle(signRequest());
    const second = handle(signRequest({ input: { chain: 'evm', message: 'second message' } }));
    await flush();
    const screen = store.get().screen;
    expect(screen?.name === 'signMessage' && screen.input.message).toBe(
      'gm from the Pockey playground',
    );
    let secondSettled = false;
    void second.then(() => {
      secondSettled = true;
    });
    await flush();
    expect(secondSettled).toBe(false);

    controller.actions.approve();
    await expect(first).resolves.toEqual({ signature: '0xsigned' });
    await flush();
    const next = store.get().screen;
    expect(next?.name === 'signMessage' && next.input.message).toBe('second message');
    expect(store.get().phase).toBe('open');
    controller.actions.approve();
    await expect(second).resolves.toEqual({ signature: '0xsigned' });
  });

  it('close rejects the pending interactive request with user_rejected', async () => {
    const { handle, store } = setup({ signedIn: true });
    const pending = handle(signRequest());
    await flush();
    expect(store.get().phase).toBe('open');
    await expect(handle({ type: 'close' })).resolves.toEqual({ ok: true });
    await expect(pending).rejects.toMatchObject({ code: 'user_rejected' });
    expect(store.get().phase).toBe('closing');
  });

  it('init narrows login methods, never widens them, and applies only the sent appearance keys', async () => {
    const { handle } = setup({ signedIn: false });
    const narrowed = (await handle({
      type: 'init',
      loginMethods: ['wallet', 'passkey', 'email'],
      appearance: { accent: '#16a34a' },
    })) as { user: EndUser | null; config: PublicAppConfig };
    expect(narrowed.user).toBeNull();
    expect(narrowed.config.loginMethods).toEqual(['email', 'passkey']);
    // Zod fills `theme: 'system'` on parse; the server theme must survive.
    expect(narrowed.config.appearance).toEqual({ theme: 'dark', accent: '#16a34a' });

    const widened = (await handle({ type: 'init', loginMethods: ['wallet', 'apple'] })) as {
      config: PublicAppConfig;
    };
    expect(widened.config.loginMethods).toEqual(['email', 'google', 'passkey']);
    expect(widened.config.loginMethods).not.toContain('wallet');
  });

  it('narrowLoginMethods keeps server order', () => {
    expect(narrowLoginMethods(['email', 'google', 'wallet'], ['wallet', 'email'])).toEqual([
      'email',
      'wallet',
    ]);
    expect(narrowLoginMethods(['email'], undefined)).toEqual(['email']);
  });
});
