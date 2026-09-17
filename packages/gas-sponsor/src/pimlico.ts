import { EVM_VIEM_CHAINS, toPocketkeyAccount } from '@pocketkey/chains-evm';
import type { EvmChainId } from '@pocketkey/types';
import { toKernelSmartAccount } from 'permissionless/accounts';
import { createSmartAccountClient } from 'permissionless';
import { createPimlicoClient, type PimlicoClient } from 'permissionless/clients/pimlico';
import {
  createPublicClient,
  http,
  type Chain,
  type HttpTransport,
  type HttpTransportConfig,
  type PublicClient,
} from 'viem';
import { entryPoint07Address } from 'viem/account-abstraction';
import { GasSponsorError } from './errors.js';
import {
  createEvmGasSponsor,
  type EvmGasSponsor,
  type EvmOwner,
  type EvmSponsorClientsFactory,
} from './evm.js';

export const KERNEL_VERSION = '0.3.1';
export const ENTRY_POINT = { address: entryPoint07Address, version: '0.7' } as const;

/** Pimlico bundler and paymaster JSON-RPC endpoint for a chain. */
export function pimlicoUrl(chainId: EvmChainId, apiKey: string): string {
  return `https://api.pimlico.io/v2/${chainId}/rpc?apikey=${encodeURIComponent(apiKey)}`;
}

export interface PimlicoClientsOptions {
  apiKey: string;
  /** Execution RPC per chain (nonce, account address, deployment). Defaults to viem's public RPC. */
  rpcUrls?: Partial<Record<EvmChainId, string>>;
  fetch?: typeof fetch;
}

/**
 * viem clients for one chain. Construction is offline: nothing is requested until
 * an action runs. Exposed for the offline construction test.
 */
export interface ChainClients {
  chain: Chain;
  publicClient: PublicClient<HttpTransport, Chain>;
  pimlicoClient: PimlicoClient<'0.7', HttpTransport, Chain>;
  bundlerTransport: HttpTransport;
}

export function buildChainClients(
  chainId: EvmChainId,
  options: PimlicoClientsOptions,
): ChainClients {
  const chain = EVM_VIEM_CHAINS[chainId];
  const transportConfig: HttpTransportConfig = { retryCount: 1 };
  if (options.fetch) transportConfig.fetchFn = options.fetch;

  const publicClient = createPublicClient({
    chain,
    transport: http(options.rpcUrls?.[chainId], transportConfig),
  });
  const bundlerTransport = http(pimlicoUrl(chainId, options.apiKey), transportConfig);
  const pimlicoClient = createPimlicoClient({
    chain,
    transport: bundlerTransport,
    entryPoint: ENTRY_POINT,
  });
  return { chain, publicClient, pimlicoClient, bundlerTransport };
}

/** Real network boundary: Kernel v3.1 on EntryPoint 0.7, Pimlico bundler and paymaster. */
export function createPimlicoClientsFactory(
  options: PimlicoClientsOptions,
): EvmSponsorClientsFactory {
  if (!options.apiKey) {
    throw new GasSponsorError('invalid_input', 'A Pimlico API key is required');
  }
  const cache = new Map<EvmChainId, ChainClients>();
  const clientsFor = (chainId: EvmChainId) => {
    let clients = cache.get(chainId);
    if (!clients) {
      clients = buildChainClients(chainId, options);
      cache.set(chainId, clients);
    }
    return clients;
  };

  // The owner carries a per-request signHash, so accounts are never cached.
  const kernelAccount = (chainId: EvmChainId, owner: EvmOwner) =>
    toKernelSmartAccount({
      client: clientsFor(chainId).publicClient,
      version: KERNEL_VERSION,
      entryPoint: ENTRY_POINT,
      owners: [toPocketkeyAccount({ address: owner.address, signHash: owner.signHash })],
    });

  return {
    async getSmartAccountAddress({ chainId, owner }) {
      const account = await kernelAccount(chainId, owner);
      return account.address;
    },

    async prepareUserOperation({ chainId, owner, calls }) {
      const { chain, publicClient, pimlicoClient, bundlerTransport } = clientsFor(chainId);
      const account = await kernelAccount(chainId, owner);
      const smartAccountClient = createSmartAccountClient({
        account,
        chain,
        client: publicClient,
        bundlerTransport,
        paymaster: pimlicoClient,
        userOperation: {
          estimateFeesPerGas: async () => (await pimlicoClient.getUserOperationGasPrice()).fast,
        },
      });
      const userOperation = await smartAccountClient.prepareUserOperation({
        calls: calls.map((call) => ({ to: call.to, value: call.value, data: call.data })),
      });

      return {
        sender: userOperation.sender,
        callGasLimit: userOperation.callGasLimit,
        verificationGasLimit: userOperation.verificationGasLimit,
        preVerificationGas: userOperation.preVerificationGas,
        paymasterVerificationGasLimit: userOperation.paymasterVerificationGasLimit ?? 0n,
        paymasterPostOpGasLimit: userOperation.paymasterPostOpGasLimit ?? 0n,
        maxFeePerGas: userOperation.maxFeePerGas,
        async send() {
          const signature = await account.signUserOperation(userOperation);
          // Sent through the account-less bundler client so viem does not prepare the
          // operation again (a fresh paymaster signature would invalidate ours).
          return pimlicoClient.sendUserOperation({
            ...userOperation,
            signature,
            entryPointAddress: ENTRY_POINT.address,
          });
        },
      };
    },

    async waitForUserOperationReceipt({ chainId, userOpHash, timeoutMs }) {
      const receipt = await clientsFor(chainId).pimlicoClient.waitForUserOperationReceipt({
        hash: userOpHash,
        timeout: timeoutMs,
      });
      return {
        transactionHash: receipt.receipt.transactionHash,
        actualGasCost: receipt.actualGasCost,
        success: receipt.success,
      };
    },
  };
}

/**
 * EVM gas sponsor backed by Pimlico. `clients` replaces the network boundary
 * (tests, or another bundler later).
 */
export function createPimlicoEvmSponsor(options: {
  apiKey: string;
  rpcUrls?: Partial<Record<EvmChainId, string>>;
  fetch?: typeof fetch;
  clients?: EvmSponsorClientsFactory;
}): EvmGasSponsor {
  if (options.clients) return createEvmGasSponsor(options.clients);
  const factoryOptions: PimlicoClientsOptions = { apiKey: options.apiKey };
  if (options.rpcUrls) factoryOptions.rpcUrls = options.rpcUrls;
  if (options.fetch) factoryOptions.fetch = options.fetch;
  return createEvmGasSponsor(createPimlicoClientsFactory(factoryOptions));
}
