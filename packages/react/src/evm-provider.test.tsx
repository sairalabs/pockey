import { act, cleanup } from '@testing-library/react';
import type { HostRequest } from '@pockey/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PockeyConfig } from './config.js';
import { ProviderRpcError } from './errors.js';
import type { EIP1193Provider } from './evm-provider.js';
import {
  EVM_ADDRESS,
  EVM_WALLET_ID,
  makeUser,
  renderPockey,
  type FakeEmbed,
  type HarnessOptions,
} from './__tests__/fake-embed.js';

const OTHER_ADDRESS = '0x000000000000000000000000000000000000dEaD';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function setup(
  options: HarnessOptions & { config?: PockeyConfig } = {},
): Promise<{ provider: EIP1193Provider; embed: FakeEmbed; chainId: () => number | undefined }> {
  const harness = await renderPockey({ initUser: makeUser(), ...options });
  const provider = harness.hooks().wallet.evm?.getProvider();
  if (!provider) throw new Error('Expected an EVM provider');
  return { provider, embed: harness.embed, chainId: () => harness.hooks().wallet.evm?.chainId };
}

async function rpcError(promise: Promise<unknown>): Promise<ProviderRpcError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ProviderRpcError) return error;
    throw error;
  }
  throw new Error('Expected a ProviderRpcError');
}

const inputOf = (request: HostRequest): unknown => ('input' in request ? request.input : undefined);

describe('EIP-1193 provider', () => {
  it('reports the selected chain as eth_chainId and net_version', async () => {
    const { provider } = await setup({ config: { chains: { evm: [{ id: 84532 }, 8453] } } });
    await expect(provider.request({ method: 'eth_chainId' })).resolves.toBe('0x14a34');
    await expect(provider.request({ method: 'net_version' })).resolves.toBe('84532');
  });

  it('defaults to Base', async () => {
    const { provider } = await setup({ config: {} });
    await expect(provider.request({ method: 'eth_chainId' })).resolves.toBe('0x2105');
  });

  it('eth_accounts is empty when logged out, eth_requestAccounts logs in', async () => {
    const user = makeUser();
    const harness = await renderPockey({
      initUser: null,
      setup: (embed) => embed.handle('login', () => ({ data: { user } })),
    });
    expect(harness.hooks().wallet.evm).toBeNull();
    const provider = harness.hooks().wallet.getEvmProvider();
    const accountsChanged = vi.fn();
    provider.on('accountsChanged', accountsChanged);

    await expect(provider.request({ method: 'eth_accounts' })).resolves.toEqual([]);

    let accounts: unknown;
    await act(async () => {
      accounts = await provider.request({ method: 'eth_requestAccounts' });
    });
    expect(accounts).toEqual([EVM_ADDRESS]);
    expect(harness.embed.requestsOf('login')).toHaveLength(1);
    expect(accountsChanged).toHaveBeenLastCalledWith([EVM_ADDRESS]);
    expect(harness.hooks().wallet.evm?.getProvider()).toBe(provider);
    await expect(provider.request({ method: 'eth_accounts' })).resolves.toEqual([EVM_ADDRESS]);

    await act(async () => {
      await harness.hooks().pockey.logout();
    });
    await expect(provider.request({ method: 'eth_accounts' })).resolves.toEqual([]);
    expect(accountsChanged).toHaveBeenLastCalledWith([]);
  });

  it('personal_sign sends hex data as raw bytes and text as a string', async () => {
    const { provider, embed } = await setup({
      setup: (fake) => fake.handle('signMessage', () => ({ data: { signature: '0xsigned' } })),
    });

    await expect(
      provider.request({ method: 'personal_sign', params: ['0x68656c6c6f', EVM_ADDRESS] }),
    ).resolves.toBe('0xsigned');
    expect(embed.last('signMessage')).toMatchObject({
      walletId: EVM_WALLET_ID,
      input: { chain: 'evm', message: { raw: '0x68656c6c6f' } },
    });

    await provider.request({
      method: 'personal_sign',
      params: ['hello', EVM_ADDRESS.toLowerCase()],
    });
    expect(inputOf(embed.last('signMessage'))).toEqual({ chain: 'evm', message: 'hello' });
  });

  it('refuses to sign for another address with 4100', async () => {
    const { provider, embed } = await setup();
    const error = await rpcError(
      provider.request({ method: 'personal_sign', params: ['hello', OTHER_ADDRESS] }),
    );
    expect(error.code).toBe(4100);
    expect(embed.requestsOf('signMessage')).toHaveLength(0);
  });

  it('eth_signTypedData_v4 parses the JSON and drops EIP712Domain', async () => {
    const { provider, embed } = await setup({
      setup: (fake) => fake.handle('signTypedData', () => ({ data: { signature: '0xtyped' } })),
    });
    const typedData = {
      domain: {
        name: 'Mail',
        version: '1',
        chainId: '0x2105',
        verifyingContract: OTHER_ADDRESS,
      },
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
        ],
        Mail: [{ name: 'contents', type: 'string' }],
      },
      primaryType: 'Mail',
      message: { contents: 'gm' },
    };

    await expect(
      provider.request({
        method: 'eth_signTypedData_v4',
        params: [EVM_ADDRESS, JSON.stringify(typedData)],
      }),
    ).resolves.toBe('0xtyped');
    expect(inputOf(embed.last('signTypedData'))).toEqual({
      chain: 'evm',
      domain: { name: 'Mail', version: '1', chainId: 8453, verifyingContract: OTHER_ADDRESS },
      types: { Mail: [{ name: 'contents', type: 'string' }] },
      primaryType: 'Mail',
      message: { contents: 'gm' },
    });
  });

  it('eth_sendTransaction converts hex quantities to decimal strings on the current chain', async () => {
    const { provider, embed } = await setup({
      config: { chains: { evm: [8453, 84532] } },
      setup: (fake) => {
        fake.handle('sendTransaction', () => ({ data: { hash: '0xhash', sponsored: false } }));
        fake.handle('signTransaction', () => ({ data: { signedTransaction: '0x02f8' } }));
      },
    });
    await act(async () => {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x14a34' }],
      });
    });

    await expect(
      provider.request({
        method: 'eth_sendTransaction',
        params: [
          {
            from: EVM_ADDRESS,
            to: OTHER_ADDRESS,
            value: '0xde0b6b3a7640000',
            data: '0xa9059cbb',
            gas: '0x5208',
            maxFeePerGas: '0x3b9aca00',
            maxPriorityFeePerGas: '0x59682f00',
            nonce: '0x7',
          },
        ],
      }),
    ).resolves.toBe('0xhash');
    expect(inputOf(embed.last('sendTransaction'))).toEqual({
      chain: 'evm',
      chainId: 84532,
      to: OTHER_ADDRESS,
      value: '1000000000000000000',
      data: '0xa9059cbb',
      gas: '21000',
      maxFeePerGas: '1000000000',
      maxPriorityFeePerGas: '1500000000',
      nonce: 7,
      sponsored: false,
    });

    await expect(
      provider.request({ method: 'eth_signTransaction', params: [{ to: OTHER_ADDRESS }] }),
    ).resolves.toBe('0x02f8');
    expect(inputOf(embed.last('signTransaction'))).toEqual({
      chain: 'evm',
      chainId: 84532,
      to: OTHER_ADDRESS,
      // Wire defaults applied by the protocol schema.
      value: '0',
      data: '0x',
    });
  });

  it('refuses a transaction from another account with 4100', async () => {
    const { provider } = await setup();
    const error = await rpcError(
      provider.request({
        method: 'eth_sendTransaction',
        params: [{ from: OTHER_ADDRESS, to: OTHER_ADDRESS }],
      }),
    );
    expect(error.code).toBe(4100);
  });

  it('wallet_switchEthereumChain emits chainChanged and returns 4902 for unknown chains', async () => {
    const { provider, chainId } = await setup({ config: { chains: { evm: [8453, 42161] } } });
    const chainChanged = vi.fn();
    provider.on('chainChanged', chainChanged);

    await act(async () => {
      await expect(
        provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xa4b1' }] }),
      ).resolves.toBeNull();
    });
    expect(chainChanged).toHaveBeenCalledWith('0xa4b1');
    expect(chainId()).toBe(42161);
    await expect(provider.request({ method: 'eth_chainId' })).resolves.toBe('0xa4b1');

    const error = await rpcError(
      provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x89' }] }),
    );
    expect(error.code).toBe(4902);

    provider.removeListener('chainChanged', chainChanged);
    await act(async () => {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x2105' }],
      });
    });
    expect(chainChanged).toHaveBeenCalledTimes(1);
  });

  it('maps user_rejected to 4001', async () => {
    const { provider } = await setup({
      setup: (fake) =>
        fake.handle('signMessage', () => ({
          error: { code: 'user_rejected', message: 'User rejected the request.' },
        })),
    });
    const error = await rpcError(
      provider.request({ method: 'personal_sign', params: ['hello', EVM_ADDRESS] }),
    );
    expect(error.code).toBe(4001);
    expect(error.message).toBe('User rejected the request.');
  });

  it('forwards read calls to the configured RPC URL', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({ jsonrpc: '2.0', id: 1, result: '0x10' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { provider } = await setup({
      config: { chains: { evm: [8453] }, rpcUrls: { 8453: 'https://rpc.example.com/base' } },
    });

    await expect(provider.request({ method: 'eth_blockNumber' })).resolves.toBe('0x10');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://rpc.example.com/base');
    expect(init?.method).toBe('POST');
    expect(typeof init?.body).toBe('string');
    expect(JSON.parse(init?.body as string)).toMatchObject({
      jsonrpc: '2.0',
      method: 'eth_blockNumber',
      params: [],
    });
  });

  it('falls back to the public RPC and relays JSON-RPC errors', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32000, message: 'execution reverted' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { provider } = await setup({ config: { chains: { evm: [1] } } });

    const error = await rpcError(
      provider.request({ method: 'eth_call', params: [{ to: OTHER_ADDRESS }, 'latest'] }),
    );
    expect(error.code).toBe(-32000);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://ethereum-rpc.publicnode.com');
  });

  it('returns 4901 for read calls on a chain without RPC URL', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { provider } = await setup({ config: { chains: { evm: [10] } } });
    const error = await rpcError(provider.request({ method: 'eth_blockNumber' }));
    expect(error.code).toBe(4901);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never forwards unsupported wallet methods to the RPC', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { provider } = await setup();
    expect((await rpcError(provider.request({ method: 'eth_sign', params: [] }))).code).toBe(4200);
    expect(
      (await rpcError(provider.request({ method: 'wallet_requestPermissions', params: [] }))).code,
    ).toBe(4200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('emits disconnect and connect on auth changes', async () => {
    const harness = await renderPockey({ initUser: makeUser() });
    const provider = harness.hooks().wallet.evm?.getProvider();
    if (!provider) throw new Error('Expected an EVM provider');
    const connect = vi.fn();
    const disconnect = vi.fn();
    provider.on('connect', connect);
    provider.on('disconnect', disconnect);

    act(() => {
      harness.embed.send({ type: 'authChanged', user: null });
    });
    expect(disconnect).toHaveBeenCalledWith(expect.objectContaining({ code: 4900 }));

    act(() => {
      harness.embed.send({ type: 'authChanged', user: makeUser() });
    });
    expect(connect).toHaveBeenCalledWith({ chainId: '0x2105' });
  });
});
