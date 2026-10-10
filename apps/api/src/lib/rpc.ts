import { createEvmRpc, type EvmRpc } from '@pockey/chains-evm';
import { createSolanaRpc, type SolanaRpc } from '@pockey/chains-solana';
import type { EvmChainId, SolanaCluster } from '@pockey/types';
import type { ParsedEnv } from '../env.js';

/**
 * RPC access behind a factory so tests (and later, per-app RPC keys) can swap
 * the transport without touching the wallet service.
 */
export interface RpcFactory {
  evm(chainId: EvmChainId): EvmRpc;
  solana(cluster: SolanaCluster): SolanaRpc;
}

let override: RpcFactory | undefined;

/** Test hook. Pass undefined to restore the real factory. */
export function setRpcFactory(factory: RpcFactory | undefined): void {
  override = factory;
}

export function getRpcFactory(config: ParsedEnv): RpcFactory {
  if (override) return override;
  return {
    evm: (chainId) => {
      const url = config.RPC_URLS[String(chainId)];
      return createEvmRpc({ chainId, ...(url ? { url } : {}) });
    },
    solana: (cluster) => {
      const url = config.RPC_URLS[`solana:${cluster}`];
      return createSolanaRpc({ cluster, ...(url ? { url } : {}) });
    },
  };
}
