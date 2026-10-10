import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PockeyEmbedError } from './errors.js';
import { usePockey, useSign, useWallet } from './hooks.js';
import { PockeyProvider } from './provider.js';
import {
  APP_ID,
  EMBED_URL,
  EVM_ADDRESS,
  EVM_WALLET_ID,
  SOLANA_ADDRESS,
  SOLANA_WALLET_ID,
  flush,
  makeServerConfig,
  makeUser,
  renderPockey,
} from './__tests__/fake-embed.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('PockeyProvider', () => {
  it('leaves exactly one iframe under StrictMode and removes it on unmount', async () => {
    const { result, embed, hooks } = await renderPockey({ strict: true });
    expect(document.querySelectorAll('iframe')).toHaveLength(1);
    expect(embed.requestsOf('init')).toHaveLength(1);
    expect(hooks().pockey.ready).toBe(true);

    result.unmount();
    expect(document.querySelectorAll('iframe')).toHaveLength(0);
  });

  it('sends host appearance and login methods with init', async () => {
    const { embed } = await renderPockey({
      config: { appearance: { theme: 'dark', accent: '#112233' }, loginMethods: ['passkey'] },
    });
    expect(embed.last('init')).toMatchObject({
      appearance: { theme: 'dark', accent: '#112233' },
      loginMethods: ['passkey'],
    });
  });

  it('login resolves the user and updates every hook', async () => {
    const user = makeUser();
    const { embed, hooks } = await renderPockey({
      setup: (fake) => fake.handle('login', () => ({ data: { user } })),
    });
    expect(hooks().pockey).toMatchObject({ ready: true, authenticated: false, user: null });
    expect(hooks().wallet.evm).toBeNull();

    let resolved: unknown;
    await act(async () => {
      resolved = await hooks().pockey.login({ method: 'email', email: 'ada@example.com' });
    });

    expect(resolved).toEqual(user);
    expect(embed.last('login')).toMatchObject({ method: 'email', email: 'ada@example.com' });
    expect(hooks().pockey).toMatchObject({ authenticated: true, user });
    expect(hooks().wallet.wallets).toHaveLength(2);
    expect(hooks().wallet.evm).toMatchObject({ address: EVM_ADDRESS, chainId: 8453 });
    expect(hooks().wallet.solana).toMatchObject({ publicKey: SOLANA_ADDRESS, cluster: 'devnet' });
  });

  it('picks up the session from init and follows authChanged events', async () => {
    const { embed, hooks } = await renderPockey({ initUser: makeUser(['evm']) });
    expect(hooks().pockey.authenticated).toBe(true);
    expect(hooks().wallet.solana).toBeNull();

    act(() => {
      embed.send({ type: 'authChanged', user: null });
    });
    expect(hooks().pockey).toMatchObject({ authenticated: false, user: null });
    expect(hooks().wallet.evm).toBeNull();
  });

  it('keeps hook results stable across unrelated re-renders', async () => {
    const config = { chains: { evm: [8453, 84532] } };
    const { hooks, rerender } = await renderPockey({ initUser: makeUser(), config });
    const before = hooks();
    // A fresh but equivalent inline config object, as apps usually write it.
    rerender({ chains: { evm: [8453, 84532] } });
    const after = hooks();
    expect(after).not.toBe(before);
    expect(after.pockey).toBe(before.pockey);
    expect(after.wallet).toBe(before.wallet);
    expect(after.sign).toBe(before.sign);
    expect(after.wallet.evm?.getProvider()).toBe(before.wallet.evm?.getProvider());
  });

  it('switchChain updates useWallet and refuses unconfigured chains', async () => {
    const { hooks } = await renderPockey({
      initUser: makeUser(),
      config: { chains: { evm: [{ id: 8453 }, { id: 84532 }] } },
    });
    const { evm } = hooks().wallet;
    await act(async () => {
      await evm?.switchChain(84532);
    });
    expect(hooks().wallet.evm?.chainId).toBe(84532);
    await expect(hooks().wallet.evm?.switchChain(1)).rejects.toMatchObject({
      code: 'chain_not_configured',
    });
  });

  it('useSign routes to the right wallet and forwards confirm', async () => {
    const { embed, hooks } = await renderPockey({
      initUser: makeUser(),
      setup: (fake) => {
        fake.handle('signMessage', () => ({ data: { signature: '0xsig' } }));
        fake.handle('sendTransaction', () => ({ data: { hash: '0xhash', sponsored: true } }));
      },
    });
    const { sign } = hooks();

    await expect(
      sign.signMessage({ chain: 'evm', message: 'hello' }, { confirm: false }),
    ).resolves.toEqual({ signature: '0xsig' });
    expect(embed.last('signMessage')).toMatchObject({
      walletId: EVM_WALLET_ID,
      input: { chain: 'evm', message: 'hello' },
      confirm: false,
    });

    await expect(
      sign.sendTransaction({ chain: 'evm', to: EVM_ADDRESS, value: '1', sponsored: true }),
    ).resolves.toEqual({ hash: '0xhash', sponsored: true });
    expect(embed.last('sendTransaction')).toMatchObject({
      walletId: EVM_WALLET_ID,
      input: { chain: 'evm', chainId: 8453, to: EVM_ADDRESS, value: '1', sponsored: true },
    });
    expect(embed.last('sendTransaction')).not.toHaveProperty('confirm');
  });

  it('solana handle encodes messages and transactions as base64', async () => {
    const { embed, hooks } = await renderPockey({
      initUser: makeUser(),
      setup: (fake) => {
        fake.handle('signMessage', () => ({ data: { signature: 'AQID' } }));
        fake.handle('sendTransaction', () => ({ data: { hash: 'sig58', sponsored: false } }));
      },
    });
    const solana = hooks().wallet.solana;
    if (!solana) throw new Error('expected a solana handle');

    await expect(solana.signMessage('hi')).resolves.toEqual(new Uint8Array([1, 2, 3]));
    expect(embed.last('signMessage')).toMatchObject({
      walletId: SOLANA_WALLET_ID,
      input: { chain: 'solana', message: 'aGk=' },
    });

    await expect(solana.sendTransaction(new Uint8Array([0, 1]))).resolves.toBe('sig58');
    expect(embed.last('sendTransaction')).toMatchObject({
      input: { chain: 'solana', cluster: 'devnet', transaction: 'AAE=' },
    });
  });

  it('rejects signing with not_authenticated when logged out', async () => {
    const { hooks } = await renderPockey();
    const error: unknown = await hooks()
      .sign.signMessage({ chain: 'evm', message: 'x' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PockeyEmbedError);
    expect(error).toMatchObject({ code: 'not_authenticated' });
  });

  it('createWallet merges the new wallet into the user', async () => {
    const created = makeUser(['solana']).wallets[0];
    const { hooks } = await renderPockey({
      initUser: makeUser(['evm']),
      setup: (fake) => fake.handle('createWallet', () => ({ data: created })),
    });
    await act(async () => {
      await hooks().wallet.createWallet('solana');
    });
    expect(hooks().wallet.solana?.publicKey).toBe(SOLANA_ADDRESS);
  });

  it('exportWallet accepts a chain family or a wallet id', async () => {
    const { embed, hooks } = await renderPockey({
      initUser: makeUser(),
      setup: (fake) => fake.handle('exportWallet', () => ({ data: { ok: true } })),
    });
    await hooks().wallet.exportWallet('solana');
    await hooks().wallet.exportWallet(EVM_WALLET_ID);
    expect(embed.requestsOf('exportWallet').map((request) => request)).toMatchObject([
      { walletId: SOLANA_WALLET_ID },
      { walletId: EVM_WALLET_ID },
    ]);
  });

  it('reports a ready timeout through onError', async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    render(
      <PockeyProvider appId={APP_ID} embedUrl={EMBED_URL} onError={onError}>
        <span />
      </PockeyProvider>,
    );
    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    await flush();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'not_ready' }));
  });

  it('uses the server chains when the host config has none', async () => {
    const { hooks } = await renderPockey({
      initUser: makeUser(),
      serverConfig: makeServerConfig({ chains: { evm: [42161], solana: ['mainnet-beta'] } }),
    });
    expect(hooks().wallet.evm?.chainId).toBe(42161);
    expect(hooks().wallet.solana?.cluster).toBe('mainnet-beta');
  });
});

describe('hooks outside the provider', () => {
  it.each([
    ['usePockey', usePockey],
    ['useWallet', useWallet],
    ['useSign', useSign],
  ] as const)('%s throws a clear error', (name, hook) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderHook(() => hook())).toThrow(
      `${name}() must be used inside <PockeyProvider>.`,
    );
  });
});
