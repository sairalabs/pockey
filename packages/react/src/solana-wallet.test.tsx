import { act, cleanup } from '@testing-library/react';
import type {
  SolanaSignAndSendTransactionFeature,
  SolanaSignMessageFeature,
  SolanaSignTransactionFeature,
} from '@solana/wallet-standard-features';
import type { Wallet, WindowAppReadyEventAPI } from '@wallet-standard/base';
import type {
  StandardConnectFeature,
  StandardDisconnectFeature,
  StandardEventsFeature,
} from '@wallet-standard/features';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { base58ToBytes } from './encoding.js';
import {
  SOLANA_ADDRESS,
  SOLANA_WALLET_ID,
  makeUser,
  renderPockey,
} from './__tests__/fake-embed.js';

type FullWallet = Wallet & {
  features: StandardConnectFeature &
    StandardDisconnectFeature &
    StandardEventsFeature &
    SolanaSignMessageFeature &
    SolanaSignTransactionFeature &
    SolanaSignAndSendTransactionFeature;
};

let registered: Wallet[] = [];
let unregister = vi.fn();

const api: WindowAppReadyEventAPI = {
  register(wallet) {
    registered.push(wallet);
    return unregister;
  },
};

function onRegister(event: Event) {
  const { detail } = event as Event & { detail: (app: WindowAppReadyEventAPI) => void };
  detail(api);
}

function onlyWallet(): FullWallet {
  expect(registered).toHaveLength(1);
  return registered[0] as FullWallet;
}

beforeEach(() => {
  registered = [];
  unregister = vi.fn();
  window.addEventListener('wallet-standard:register-wallet', onRegister);
});

afterEach(() => {
  window.removeEventListener('wallet-standard:register-wallet', onRegister);
  cleanup();
});

describe('Solana Wallet Standard wallet', () => {
  it('registers once with the expected shape and unregisters on unmount', async () => {
    const { result } = await renderPockey({ initUser: makeUser() });
    const wallet = onlyWallet();

    expect(wallet.name).toBe('Pockey');
    expect(wallet.version).toBe('1.0.0');
    expect(wallet.icon).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(wallet.chains).toEqual(['solana:devnet']);
    expect(Object.keys(wallet.features).sort()).toEqual([
      'solana:signAndSendTransaction',
      'solana:signMessage',
      'solana:signTransaction',
      'standard:connect',
      'standard:disconnect',
      'standard:events',
    ]);
    expect(wallet.features['solana:signTransaction']).toMatchObject({
      version: '1.0.0',
      supportedTransactionVersions: ['legacy', 0],
    });
    expect(wallet.features['solana:signAndSendTransaction']).toMatchObject({
      version: '1.0.0',
      supportedTransactionVersions: ['legacy', 0],
    });

    const [account] = wallet.accounts;
    expect(account?.address).toBe(SOLANA_ADDRESS);
    expect(account?.publicKey).toEqual(base58ToBytes(SOLANA_ADDRESS));
    expect(account?.publicKey).toHaveLength(32);
    expect(account?.chains).toEqual(['solana:devnet']);
    expect(wallet.accounts[0]).toBe(account);

    result.unmount();
    expect(unregister).toHaveBeenCalledTimes(1);
  });

  it('maps mainnet-beta to solana:mainnet', async () => {
    await renderPockey({
      initUser: makeUser(),
      config: { chains: { solana: ['mainnet-beta', 'devnet'] } },
    });
    expect(onlyWallet().chains).toEqual(['solana:mainnet', 'solana:devnet']);
  });

  it('does not register without a Solana wallet or when disabled', async () => {
    const first = await renderPockey({ initUser: makeUser(['evm']) });
    expect(registered).toHaveLength(0);
    first.result.unmount();

    await renderPockey({ initUser: makeUser(), config: { solana: { walletStandard: false } } });
    expect(registered).toHaveLength(0);
  });

  it('registers with an app that loads after the provider', async () => {
    window.removeEventListener('wallet-standard:register-wallet', onRegister);
    await renderPockey({ initUser: makeUser() });
    expect(registered).toHaveLength(0);

    window.dispatchEvent(Object.assign(new Event('wallet-standard:app-ready'), { detail: api }));
    expect(registered).toHaveLength(1);
  });

  it('stays registered across logout and reports account changes', async () => {
    const { embed } = await renderPockey({ initUser: makeUser() });
    const wallet = onlyWallet();
    const change = vi.fn();
    const off = wallet.features['standard:events'].on('change', change);

    act(() => {
      embed.send({ type: 'authChanged', user: null });
    });
    expect(registered).toHaveLength(1);
    expect(wallet.accounts).toEqual([]);
    expect(change).toHaveBeenLastCalledWith({ accounts: [] });

    act(() => {
      embed.send({ type: 'authChanged', user: makeUser() });
    });
    expect(change).toHaveBeenLastCalledWith({ accounts: wallet.accounts });
    off();
  });

  it('connect, disconnect and signing go through the embed', async () => {
    const signature = new Uint8Array(64).fill(7);
    const { embed } = await renderPockey({
      initUser: makeUser(),
      setup: (fake) => {
        fake.handle('signMessage', () => ({
          data: { signature: btoa(String.fromCharCode(...signature)) },
        }));
        fake.handle('signTransaction', () => ({ data: { signedTransaction: 'AQID' } }));
        // "2NEpo7TZRRrLZSi2U" is base58 for "Hello World!".
        fake.handle('sendTransaction', () => ({
          data: { hash: '2NEpo7TZRRrLZSi2U', sponsored: false },
        }));
      },
    });
    const wallet = onlyWallet();

    const { accounts } = await wallet.features['standard:connect'].connect({ silent: true });
    const account = accounts[0];
    if (!account) throw new Error('expected an account');
    expect(account.address).toBe(SOLANA_ADDRESS);

    const message = new TextEncoder().encode('gm');
    const [signed] = await wallet.features['solana:signMessage'].signMessage({ account, message });
    expect(signed?.signature).toEqual(signature);
    expect(signed?.signedMessage).toEqual(message);
    expect(embed.last('signMessage')).toMatchObject({
      walletId: SOLANA_WALLET_ID,
      input: { chain: 'solana', message: 'Z20=' },
    });

    const [signedTx] = await wallet.features['solana:signTransaction'].signTransaction({
      account,
      chain: 'solana:devnet',
      transaction: new Uint8Array([9, 9]),
    });
    expect(signedTx?.signedTransaction).toEqual(new Uint8Array([1, 2, 3]));
    expect(embed.last('signTransaction')).toMatchObject({
      input: { chain: 'solana', cluster: 'devnet', transaction: 'CQk=' },
    });

    const [sent] = await wallet.features['solana:signAndSendTransaction'].signAndSendTransaction({
      account,
      chain: 'solana:devnet',
      transaction: new Uint8Array([9, 9]),
    });
    expect(new TextDecoder().decode(sent?.signature)).toBe('Hello World!');

    await expect(
      wallet.features['solana:signTransaction'].signTransaction({
        account,
        chain: 'solana:testnet',
        transaction: new Uint8Array([1]),
      }),
    ).rejects.toMatchObject({ code: 'unsupported' });

    await wallet.features['standard:disconnect'].disconnect();
    expect(wallet.accounts).toEqual([]);
    await expect(
      wallet.features['solana:signMessage'].signMessage({ account, message }),
    ).rejects.toMatchObject({ code: 'not_authenticated' });
  });
});
