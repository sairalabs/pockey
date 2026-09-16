import type { Chain } from 'viem';
import { arbitrum, base, baseSepolia, mainnet, polygon, sepolia } from 'viem/chains';
import type { EvmChainId } from '@pocketkey/types';

/** viem chain definitions for every EVM chain supported by Pocketkey, keyed by chainId. */
export const EVM_VIEM_CHAINS: Record<EvmChainId, Chain> = {
  1: mainnet,
  8453: base,
  42161: arbitrum,
  137: polygon,
  84532: baseSepolia,
  11155111: sepolia,
};
