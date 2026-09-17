import type { EvmChainId } from '@pocketkey/types';
import { RpcRequestError, type Address, type Hex } from 'viem';
import { describe, expect, it, vi } from 'vitest';
import { GasSponsorError } from './errors.js';
import {
  createEvmGasSponsor,
  maxGasCostWei,
  redactSecrets,
  type EvmCall,
  type EvmOwner,
  type EvmSponsorClientsFactory,
  type PreparedUserOperation,
} from './evm.js';
import {
  buildChainClients,
  createPimlicoClientsFactory,
  createPimlicoEvmSponsor,
  ENTRY_POINT,
  pimlicoUrl,
} from './pimlico.js';

const OWNER: EvmOwner = {
  address: '0x1111111111111111111111111111111111111111',
  signHash: async () => `0x${'00'.repeat(65)}`,
};
const SMART_ACCOUNT: Address = '0x2222222222222222222222222222222222222222';
const USER_OP_HASH: Hex = `0x${'ab'.repeat(32)}`;
const TX_HASH: Hex = `0x${'cd'.repeat(32)}`;

const GAS = {
  callGasLimit: 100_000n,
  verificationGasLimit: 200_000n,
  preVerificationGas: 50_000n,
  paymasterVerificationGasLimit: 30_000n,
  paymasterPostOpGasLimit: 20_000n,
  maxFeePerGas: 2_000_000_000n,
};

function fakeFactory(overrides: Partial<EvmSponsorClientsFactory> = {}) {
  const send = vi.fn(async () => USER_OP_HASH);
  const getSmartAccountAddress = vi.fn(async () => SMART_ACCOUNT);
  const prepareUserOperation = vi.fn(async (): Promise<PreparedUserOperation> => ({
    sender: SMART_ACCOUNT,
    ...GAS,
    send,
  }));
  const waitForUserOperationReceipt = vi.fn(async () => ({
    transactionHash: TX_HASH,
    actualGasCost: 123_456_789n,
    success: true,
  }));
  const factory: EvmSponsorClientsFactory = {
    getSmartAccountAddress,
    prepareUserOperation,
    waitForUserOperationReceipt,
    ...overrides,
  };
  return {
    factory,
    send,
    getSmartAccountAddress,
    prepareUserOperation,
    waitForUserOperationReceipt,
  };
}

describe('pimlicoUrl', () => {
  it('builds the v2 RPC URL per chain', () => {
    expect(pimlicoUrl(8453, 'pim_test')).toBe('https://api.pimlico.io/v2/8453/rpc?apikey=pim_test');
    expect(pimlicoUrl(84532, 'a&b')).toBe('https://api.pimlico.io/v2/84532/rpc?apikey=a%26b');
  });
});

describe('maxGasCostWei', () => {
  it('sums every gas limit and multiplies by maxFeePerGas', () => {
    expect(maxGasCostWei(GAS)).toBe(400_000n * 2_000_000_000n);
    expect(maxGasCostWei({ ...GAS, maxFeePerGas: 0n })).toBe(0n);
  });
});

describe('createEvmGasSponsor', () => {
  it('passes normalized calls to the factory and returns the cost bound', async () => {
    const { factory, send, prepareUserOperation } = fakeFactory();
    const sponsor = createEvmGasSponsor(factory);
    const calls: (EvmCall & { extra?: string })[] = [
      {
        to: '0x3333333333333333333333333333333333333333',
        value: 0n,
        data: '0xa9059cbb',
        extra: 'x',
      },
      { to: '0x4444444444444444444444444444444444444444', value: 10n ** 15n, data: '0x' },
    ];

    const result = await sponsor.sendUserOperation({ chainId: 8453, owner: OWNER, calls });

    expect(result).toEqual({
      userOpHash: USER_OP_HASH,
      smartAccountAddress: SMART_ACCOUNT,
      maxGasCostWei: 800_000_000_000_000n,
    });
    expect(prepareUserOperation).toHaveBeenCalledTimes(1);
    expect(prepareUserOperation).toHaveBeenCalledWith({
      chainId: 8453,
      owner: OWNER,
      calls: [
        { to: '0x3333333333333333333333333333333333333333', value: 0n, data: '0xa9059cbb' },
        { to: '0x4444444444444444444444444444444444444444', value: 10n ** 15n, data: '0x' },
      ],
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid calls before touching the bundler', async () => {
    const { factory, prepareUserOperation } = fakeFactory();
    const sponsor = createEvmGasSponsor(factory);
    const bad: EvmCall[][] = [
      [],
      [{ to: '0x12', value: 0n, data: '0x' }],
      [{ to: SMART_ACCOUNT, value: -1n, data: '0x' }],
      [{ to: SMART_ACCOUNT, value: 0n, data: '0xzz' }],
    ];
    for (const calls of bad) {
      await expect(
        sponsor.sendUserOperation({ chainId: 8453, owner: OWNER, calls }),
      ).rejects.toMatchObject({ code: 'invalid_input' });
    }
    await expect(
      sponsor.sendUserOperation({
        chainId: 10 as EvmChainId,
        owner: OWNER,
        calls: [{ to: SMART_ACCOUNT, value: 0n, data: '0x' }],
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    expect(prepareUserOperation).not.toHaveBeenCalled();
  });

  it('returns the smart account address from the factory', async () => {
    const { factory, getSmartAccountAddress } = fakeFactory();
    const sponsor = createEvmGasSponsor(factory);
    await expect(sponsor.getSmartAccountAddress({ chainId: 137, owner: OWNER })).resolves.toBe(
      SMART_ACCOUNT,
    );
    expect(getSmartAccountAddress).toHaveBeenCalledWith({ chainId: 137, owner: OWNER });
  });

  it('maps the receipt and applies the default timeout', async () => {
    const { factory, waitForUserOperationReceipt } = fakeFactory();
    const sponsor = createEvmGasSponsor(factory);
    await expect(
      sponsor.waitForReceipt({ chainId: 8453, userOpHash: USER_OP_HASH }),
    ).resolves.toEqual({ transactionHash: TX_HASH, actualGasCostWei: 123_456_789n, success: true });
    expect(waitForUserOperationReceipt).toHaveBeenCalledWith({
      chainId: 8453,
      userOpHash: USER_OP_HASH,
      timeoutMs: 60_000,
    });

    waitForUserOperationReceipt.mockResolvedValueOnce({
      transactionHash: TX_HASH,
      actualGasCost: 0n,
      success: false,
    });
    await expect(
      sponsor.waitForReceipt({ chainId: 8453, userOpHash: USER_OP_HASH, timeoutMs: 5 }),
    ).resolves.toEqual({ transactionHash: TX_HASH, actualGasCostWei: 0n, success: false });
    expect(waitForUserOperationReceipt).toHaveBeenLastCalledWith({
      chainId: 8453,
      userOpHash: USER_OP_HASH,
      timeoutMs: 5,
    });
  });

  it('wraps bundler failures as bundler_error with the RPC message', async () => {
    const rpcError = new RpcRequestError({
      body: { method: 'eth_estimateUserOperationGas' },
      url: 'https://api.pimlico.io/v2/8453/rpc?apikey=secret',
      error: { code: -32500, message: "AA21 didn't pay prefund" },
    });
    const { factory } = fakeFactory({
      prepareUserOperation: async () => {
        throw rpcError;
      },
    });
    const sponsor = createEvmGasSponsor(factory);
    const error: unknown = await sponsor
      .sendUserOperation({
        chainId: 8453,
        owner: OWNER,
        calls: [{ to: SMART_ACCOUNT, value: 0n, data: '0x' }],
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GasSponsorError);
    expect(error).toMatchObject({
      code: 'bundler_error',
      details: { rpcMessage: "AA21 didn't pay prefund" },
    });
    expect((error as Error).message).toContain("AA21 didn't pay prefund");
    expect((error as Error).message).not.toContain('secret');
  });

  it('wraps send and receipt failures too', async () => {
    const { factory } = fakeFactory({
      prepareUserOperation: async () => ({
        sender: SMART_ACCOUNT,
        ...GAS,
        send: async () => {
          throw new Error('replacement underpriced');
        },
      }),
      waitForUserOperationReceipt: async () => {
        throw new Error('Timed out while waiting for User Operation');
      },
    });
    const sponsor = createEvmGasSponsor(factory);
    await expect(
      sponsor.sendUserOperation({
        chainId: 8453,
        owner: OWNER,
        calls: [{ to: SMART_ACCOUNT, value: 0n, data: '0x' }],
      }),
    ).rejects.toMatchObject({ code: 'bundler_error', message: /replacement underpriced/ });
    await expect(
      sponsor.waitForReceipt({ chainId: 8453, userOpHash: USER_OP_HASH }),
    ).rejects.toMatchObject({ code: 'bundler_error', message: /Timed out/ });
    await expect(
      sponsor.waitForReceipt({ chainId: 8453, userOpHash: '0x1234' }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('redacts API keys from messages', () => {
    expect(redactSecrets('POST https://api.pimlico.io/v2/1/rpc?apikey=pim_abc&x=1 failed')).toBe(
      'POST https://api.pimlico.io/v2/1/rpc?apikey=***&x=1 failed',
    );
  });
});

describe('createPimlicoEvmSponsor (real clients)', () => {
  it('builds viem and Pimlico clients without any network access', () => {
    const fetchMock = vi.fn(async () => Response.json({}));
    const clients = buildChainClients(84532, {
      apiKey: 'pim_test',
      rpcUrls: { 84532: 'https://rpc.example/base-sepolia' },
      fetch: fetchMock,
    });
    expect(clients.chain.id).toBe(84532);
    expect(clients.publicClient.chain.id).toBe(84532);
    expect(clients.pimlicoClient.chain.id).toBe(84532);
    expect(typeof clients.pimlicoClient.getUserOperationGasPrice).toBe('function');
    expect(typeof clients.pimlicoClient.sendUserOperation).toBe('function');
    expect(ENTRY_POINT).toEqual({
      address: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
      version: '0.7',
    });

    expect(createPimlicoClientsFactory({ apiKey: 'pim_test', fetch: fetchMock })).toBeDefined();
    const sponsor = createPimlicoEvmSponsor({ apiKey: 'pim_test', fetch: fetchMock });
    expect(typeof sponsor.sendUserOperation).toBe('function');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires an API key', () => {
    expect(() => createPimlicoEvmSponsor({ apiKey: '' })).toThrow(GasSponsorError);
  });

  it('routes bundler calls through the injected fetch and redacts the key on failure', async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      urls.push(input instanceof Request ? input.url : String(input));
      return new Response('upstream down', { status: 503 });
    });
    const sponsor = createPimlicoEvmSponsor({ apiKey: 'pim_secret_key', fetch: fetchMock });
    const error: unknown = await sponsor
      .waitForReceipt({ chainId: 84532, userOpHash: USER_OP_HASH, timeoutMs: 2_000 })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'bundler_error' });
    expect(JSON.stringify((error as GasSponsorError).details)).not.toContain('pim_secret_key');
    expect((error as Error).message).not.toContain('pim_secret_key');
    expect(urls.length).toBeGreaterThan(0);
    expect(urls[0]).toBe(pimlicoUrl(84532, 'pim_secret_key'));
  });
});
