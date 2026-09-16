import type {
  Appearance,
  CreateOnLogin,
  LoginMethod,
  PublicAppConfig,
  SolanaCluster,
} from '@pocketkey/types';

export const DEFAULT_EMBED_URL = 'https://embed.pocketkey.dev';

/** A chain id or any chain object with a numeric `id` (as exported by common EVM libraries). */
export type ChainLike = number | { id: number };

export interface PocketkeyConfig {
  loginMethods?: LoginMethod[];
  chains?: { evm?: ChainLike[]; solana?: SolanaCluster[] };
  appearance?: Partial<Appearance>;
  /** Informative only for now: the server config decides. */
  embeddedWallets?: { createOnLogin?: CreateOnLogin };
  /** RPC endpoints used by the EIP-1193 provider for read calls, keyed by chain id. */
  rpcUrls?: Partial<Record<number, string>>;
  solana?: { walletStandard?: boolean };
}

export const DEFAULT_EVM_CHAIN_ID = 8453;
export const DEFAULT_SOLANA_CLUSTER: SolanaCluster = 'mainnet-beta';

/** Public endpoints for the MVP chains. Rate limited: pass `rpcUrls` in production. */
export const PUBLIC_RPC_URLS: Readonly<Record<number, string>> = {
  1: 'https://ethereum-rpc.publicnode.com',
  8453: 'https://mainnet.base.org',
  42161: 'https://arb1.arbitrum.io/rpc',
  137: 'https://polygon-bor-rpc.publicnode.com',
  84532: 'https://sepolia.base.org',
  11155111: 'https://ethereum-sepolia-rpc.publicnode.com',
};

const chainId = (chain: ChainLike): number => (typeof chain === 'number' ? chain : chain.id);

/** Host config wins, then the server config returned by `init`, then the defaults. */
export function resolveEvmChains(
  config: PocketkeyConfig | undefined,
  server: PublicAppConfig | null,
): number[] {
  const host = config?.chains?.evm?.map(chainId);
  if (host && host.length > 0) return [...new Set(host)];
  if (server && server.chains.evm.length > 0) return [...server.chains.evm];
  return [DEFAULT_EVM_CHAIN_ID];
}

export function resolveSolanaClusters(
  config: PocketkeyConfig | undefined,
  server: PublicAppConfig | null,
): SolanaCluster[] {
  const host = config?.chains?.solana;
  if (host && host.length > 0) return [...new Set(host)];
  if (server && server.chains.solana.length > 0) return [...server.chains.solana];
  return [DEFAULT_SOLANA_CLUSTER];
}
