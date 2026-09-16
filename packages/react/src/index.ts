export { PocketkeyProvider, type PocketkeyProviderProps } from './provider.js';
export {
  usePocketkey,
  useSign,
  useWallet,
  type EvmWalletHandle,
  type SolanaWalletHandle,
  type UsePocketkeyResult,
  type UseSignResult,
  type UseWalletResult,
} from './hooks.js';
export {
  DEFAULT_EMBED_URL,
  PUBLIC_RPC_URLS,
  type ChainLike,
  type PocketkeyConfig,
} from './config.js';
export { PocketkeyEmbedError, ProviderRpcError } from './errors.js';
export {
  createEmbedBridge,
  READY_TIMEOUT_MS,
  type EmbedBridge,
  type EmbedBridgeOptions,
  type EmbedInitOptions,
  type HostRequestPayload,
} from './bridge.js';
export {
  toProviderRpcError,
  type EIP1193Provider,
  type EIP1193RequestArguments,
  type PocketkeyEIP1193Provider,
} from './evm-provider.js';
export { POCKETKEY_WALLET_ICON, SOLANA_CHAIN_BY_CLUSTER } from './solana-wallet.js';
export type {
  EvmTransactionParams,
  LoginOptions,
  SendTransactionParams,
  SignMessageParams,
  SignOptions,
  SignTypedDataParams,
  SolanaTransactionParams,
  TransactionParams,
  WalletRef,
} from './client.js';
