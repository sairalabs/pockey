import {
  decodeKernelExecute,
  deserializeUserOperation,
  serializeUserOperation,
  toPockeyAccount,
  userOperationDigest,
} from '@pockey/chains-evm';
import { toKernelSmartAccount } from 'permissionless/accounts';
import { describe, expect, it, vi } from 'vitest';
import type { Address, Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { buildChainClients, ENTRY_POINT, KERNEL_VERSION } from './pimlico.js';

/**
 * The iframe signs a sponsored user operation only after recomputing its digest
 * and decoding its call (chains-evm). These checks pin both against the real
 * Kernel v3.1 account from permissionless, offline.
 */
describe('Kernel v3.1 user operations', () => {
  const owner = privateKeyToAccount(generatePrivateKey());
  const sender: Address = '0x5555555555555555555555555555555555555555';
  const fetchMock = vi.fn(async () => Response.json({}));

  async function kernel() {
    return toKernelSmartAccount({
      client: buildChainClients(84532, { apiKey: 'pim_test', fetch: fetchMock }).publicClient,
      version: KERNEL_VERSION,
      entryPoint: ENTRY_POINT,
      owners: [
        toPockeyAccount({
          address: owner.address,
          signHash: (hash) => owner.sign({ hash }),
        }),
      ],
      address: sender,
    });
  }

  it('decodes the single call Kernel encodes', async () => {
    const account = await kernel();
    const call = {
      to: '0x4200000000000000000000000000000000000006' as Address,
      value: 12345n,
      data: '0xa9059cbb0000' as Hex,
    };
    expect(decodeKernelExecute(await account.encodeCalls([call]))).toEqual(call);
    const empty = { to: call.to, value: 0n, data: '0x' as Hex };
    expect(decodeKernelExecute(await account.encodeCalls([empty]))).toEqual(empty);
    // A batch is refused: the user approves exactly one call.
    await expect(async () =>
      decodeKernelExecute(await account.encodeCalls([call, empty])),
    ).rejects.toThrow();
  });

  it('computes the digest the Kernel owner signs', async () => {
    const account = await kernel();
    const userOperation = {
      sender,
      nonce: 7n,
      callData: await account.encodeCalls([{ to: sender, value: 1n, data: '0x' }]),
      callGasLimit: 100_000n,
      verificationGasLimit: 200_000n,
      preVerificationGas: 50_000n,
      maxFeePerGas: 2_000_000_000n,
      maxPriorityFeePerGas: 1_000_000n,
      paymaster: '0x6666666666666666666666666666666666666666' as Address,
      paymasterVerificationGasLimit: 30_000n,
      paymasterPostOpGasLimit: 20_000n,
      paymasterData: '0x1234' as Hex,
      signature: '0x' as Hex,
    };
    const expected = await account.signUserOperation({ ...userOperation, chainId: 84532 });

    const roundTrip = deserializeUserOperation(serializeUserOperation(userOperation));
    const { digest } = userOperationDigest({
      userOperation: roundTrip,
      chainId: 84532,
      entryPointAddress: ENTRY_POINT.address,
    });
    expect(await owner.sign({ hash: digest })).toBe(expected);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
