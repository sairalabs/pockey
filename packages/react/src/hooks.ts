import type {
  ChainFamily,
  EndUser,
  LoginMethod,
  SendTransactionOutput,
  SignMessageOutput,
  SignTransactionOutput,
  SolanaCluster,
  Wallet,
} from '@pocketkey/types';
import { useContext, useMemo, useSyncExternalStore } from 'react';
import {
  findWallet,
  selectChainId,
  selectCluster,
  type ClientSnapshot,
  type PocketkeyClient,
  type SendTransactionParams,
  type SignMessageParams,
  type SignOptions,
  type SignTypedDataParams,
  type TransactionParams,
  type WalletRef,
} from './client.js';
import { base64ToBytes, bytesToBase64, isHex, utf8ToBytes } from './encoding.js';
import type { EIP1193Provider } from './evm-provider.js';
import { PocketkeyContext, type PocketkeyContextValue } from './provider.js';

export interface UsePocketkeyResult {
  /** True once the embed loaded and answered `init`. */
  ready: boolean;
  authenticated: boolean;
  user: EndUser | null;
  /** Opens the modal. `{ method: 'email', email }` skips the method picker. */
  login: (options?: { method?: LoginMethod; email?: string }) => Promise<EndUser>;
  logout: () => Promise<void>;
  registerPasskey: () => Promise<EndUser>;
}

export interface EvmWalletHandle {
  address: `0x${string}`;
  chainId: number;
  switchChain: (chainId: number) => Promise<void>;
  getProvider: () => EIP1193Provider;
}

export interface SolanaWalletHandle {
  /** Base58 public key. */
  publicKey: string;
  cluster: SolanaCluster;
  /** Strings are signed as UTF-8 bytes. Returns the 64-byte signature. */
  signMessage: (message: Uint8Array | string) => Promise<Uint8Array>;
  /** Accepts serialized bytes or base64. Returns the signed serialized transaction. */
  signTransaction: (transaction: Uint8Array | string) => Promise<Uint8Array>;
  /** Returns the base58 transaction signature. */
  sendTransaction: (
    transaction: Uint8Array | string,
    options?: { cluster?: SolanaCluster; sponsored?: boolean },
  ) => Promise<string>;
}

export interface UseWalletResult {
  wallets: Wallet[];
  evm: EvmWalletHandle | null;
  solana: SolanaWalletHandle | null;
  createWallet: (chainFamily: ChainFamily) => Promise<Wallet>;
  exportWallet: (chainFamilyOrWalletId: WalletRef) => Promise<void>;
  /**
   * The same EIP-1193 provider as `evm.getProvider()`, available while logged out so
   * connectors can call `eth_requestAccounts` to open the login modal.
   */
  getEvmProvider: () => EIP1193Provider;
}

export interface UseSignResult {
  signMessage: (input: SignMessageParams, options?: SignOptions) => Promise<SignMessageOutput>;
  signTypedData: (input: SignTypedDataParams, options?: SignOptions) => Promise<SignMessageOutput>;
  sendTransaction: (
    input: SendTransactionParams,
    options?: SignOptions,
  ) => Promise<SendTransactionOutput>;
  signTransaction: (
    input: TransactionParams,
    options?: SignOptions,
  ) => Promise<SignTransactionOutput>;
}

const NO_WALLETS: Wallet[] = [];

function usePocketkeyContext(hook: string): PocketkeyContextValue {
  const context = useContext(PocketkeyContext);
  if (!context) {
    throw new Error(`${hook}() must be used inside <PocketkeyProvider>.`);
  }
  return context;
}

function useSnapshot(client: PocketkeyClient): ClientSnapshot {
  return useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
}

export function usePocketkey(): UsePocketkeyResult {
  const { client } = usePocketkeyContext('usePocketkey');
  const { ready, user } = useSnapshot(client);
  return useMemo(
    () => ({
      ready,
      authenticated: user !== null,
      user,
      login: client.login,
      logout: client.logout,
      registerPasskey: client.registerPasskey,
    }),
    [client, ready, user],
  );
}

const toBase64 = (value: Uint8Array | string): string =>
  typeof value === 'string' ? value : bytesToBase64(value);

function solanaHandle(
  client: PocketkeyClient,
  publicKey: string,
  cluster: SolanaCluster,
): SolanaWalletHandle {
  return {
    publicKey,
    cluster,
    async signMessage(message) {
      const bytes = typeof message === 'string' ? utf8ToBytes(message) : message;
      const { signature } = await client.signMessage({
        chain: 'solana',
        message: bytesToBase64(bytes),
      });
      return base64ToBytes(signature);
    },
    async signTransaction(transaction) {
      const { signedTransaction } = await client.signTransaction({
        chain: 'solana',
        cluster,
        transaction: toBase64(transaction),
      });
      return base64ToBytes(signedTransaction);
    },
    async sendTransaction(transaction, options = {}) {
      const { hash } = await client.sendTransaction({
        chain: 'solana',
        cluster: options.cluster ?? cluster,
        transaction: toBase64(transaction),
        ...(options.sponsored !== undefined ? { sponsored: options.sponsored } : {}),
      });
      return hash;
    },
  };
}

export function useWallet(): UseWalletResult {
  const { client, config } = usePocketkeyContext('useWallet');
  const snapshot = useSnapshot(client);
  const { user } = snapshot;
  const chainId = selectChainId(config, snapshot);
  const cluster = selectCluster(config, snapshot);

  return useMemo(() => {
    const evmWallet = findWallet(user, 'evm');
    const solanaWallet = findWallet(user, 'solana');
    const evmAddress = evmWallet?.address;
    return {
      wallets: user?.wallets ?? NO_WALLETS,
      evm: isHex(evmAddress)
        ? {
            address: evmAddress,
            chainId,
            switchChain: client.switchChain,
            getProvider: client.getEvmProvider,
          }
        : null,
      solana: solanaWallet ? solanaHandle(client, solanaWallet.address, cluster) : null,
      createWallet: client.createWallet,
      exportWallet: client.exportWallet,
      getEvmProvider: client.getEvmProvider,
    };
  }, [client, user, chainId, cluster]);
}

export function useSign(): UseSignResult {
  const { client } = usePocketkeyContext('useSign');
  return useMemo(
    () => ({
      signMessage: client.signMessage,
      signTypedData: client.signTypedData,
      sendTransaction: client.sendTransaction,
      signTransaction: client.signTransaction,
    }),
    [client],
  );
}
