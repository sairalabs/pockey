/**
 * `@pocketkey/react`: embedded wallets for React apps.
 *
 * Wrap the app in `<PocketkeyProvider appId="pk_app_...">`. The provider mounts the Pocketkey
 * iframe, which owns the tokens, the login modal and every confirmation screen. The host page
 * only ever sees the user, wallets and signatures.
 *
 * Hooks:
 * - `usePocketkey()`: readiness, the user, `login`, `logout`, `registerPasskey`.
 * - `useWallet()`: EVM and Solana wallet handles, `createWallet`, `exportWallet`, and an
 *   EIP-1193 provider for viem, wagmi or ethers.
 * - `useSign()`: `signMessage`, `signTypedData`, `signTransaction`, `sendTransaction`, each
 *   behind a confirmation screen unless `{ confirm: false }`.
 * - `useSessionSigners()`: session signers. `createSession` asks the user once, on a consent
 *   screen describing the policy (duration, networks, value caps, contracts or programs);
 *   `signWithSession` then signs within that policy without any UI; `revokeSession` ends it.
 *   A refusal rejects `PocketkeyEmbedError` with `code: 'policy_violation'` and `reason`.
 *
 * Every rejection is a `PocketkeyEmbedError` with a stable `code` (`user_rejected`,
 * `not_authenticated`, `not_ready`, or an API error code).
 */
export { PocketkeyProvider, type PocketkeyProviderProps } from './provider.js';
export {
  usePocketkey,
  useSessionSigners,
  useSign,
  useWallet,
  type EvmWalletHandle,
  type SolanaWalletHandle,
  type UsePocketkeyResult,
  type UseSessionSignersResult,
  type UseSignResult,
  type UseWalletResult,
} from './hooks.js';
export {
  DEFAULT_EMBED_URL,
  PUBLIC_RPC_URLS,
  type ChainLike,
  type PocketkeyConfig,
} from './config.js';
/** `PocketkeyEmbedError` for every embed call, `ProviderRpcError` from the EIP-1193 provider. */
export { PocketkeyEmbedError, ProviderRpcError } from './errors.js';
/** Framework-free bridge to the embed iframe, for non React hosts. */
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
  CreateSessionParams,
  EvmTransactionParams,
  LoginOptions,
  SendTransactionParams,
  SessionSignParams,
  SignMessageParams,
  SignOptions,
  SignTypedDataParams,
  SolanaTransactionParams,
  TransactionParams,
  WalletRef,
} from './client.js';
/** Session signer shapes, re-exported so apps do not need `@pocketkey/types` directly. */
export type {
  PolicyViolation,
  SessionSigner,
  SessionSignOutput,
  SigningPolicy,
} from '@pocketkey/types';
