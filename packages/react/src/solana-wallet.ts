import type {
  SolanaSignAndSendTransactionFeature,
  SolanaSignAndSendTransactionMethod,
  SolanaSignMessageFeature,
  SolanaSignMessageMethod,
  SolanaSignTransactionFeature,
  SolanaSignTransactionMethod,
} from '@solana/wallet-standard-features';
import type {
  IdentifierString,
  Wallet,
  WalletAccount,
  WindowAppReadyEventAPI,
} from '@wallet-standard/base';
import type {
  StandardConnectFeature,
  StandardConnectMethod,
  StandardDisconnectFeature,
  StandardDisconnectMethod,
  StandardEventsFeature,
  StandardEventsListeners,
  StandardEventsNames,
  StandardEventsOnMethod,
} from '@wallet-standard/features';
import type { SolanaCluster } from '@pocketkey/types';
import type { PocketkeyClient } from './client.js';
import { base58ToBytes, base64ToBytes, bytesToBase64 } from './encoding.js';
import { PocketkeyEmbedError } from './errors.js';

/** Wallet Standard chain ids, see @solana/wallet-standard-chains. */
export const SOLANA_CHAIN_BY_CLUSTER = {
  'mainnet-beta': 'solana:mainnet',
  devnet: 'solana:devnet',
} as const satisfies Record<SolanaCluster, IdentifierString>;

const CLUSTER_BY_CHAIN: Partial<Record<string, SolanaCluster>> = {
  'solana:mainnet': 'mainnet-beta',
  'solana:devnet': 'devnet',
};

const ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="24" fill="#d2042d"/><circle cx="40" cy="48" r="16" fill="none" stroke="#fff" stroke-width="8"/><path d="M56 48h24M70 48v12" stroke="#fff" stroke-width="8" stroke-linecap="round"/></svg>';

export const POCKETKEY_WALLET_ICON: `data:image/svg+xml;base64,${string}` = `data:image/svg+xml;base64,${btoa(ICON_SVG)}`;

const ACCOUNT_FEATURES = [
  'solana:signMessage',
  'solana:signTransaction',
  'solana:signAndSendTransaction',
] as const;

type PocketkeyWalletFeatures = StandardConnectFeature &
  StandardDisconnectFeature &
  StandardEventsFeature &
  SolanaSignMessageFeature &
  SolanaSignTransactionFeature &
  SolanaSignAndSendTransactionFeature;

export interface PocketkeySolanaWallet extends Wallet {
  readonly features: PocketkeyWalletFeatures;
  /** Stops listening to the client. Call after unregistering. */
  dispose(): void;
}

export function createSolanaWallet(client: PocketkeyClient): PocketkeySolanaWallet {
  const listeners: { [E in StandardEventsNames]?: Set<StandardEventsListeners[E]> } = {};
  let disconnected = false;
  let cachedAccount: { key: string; account: WalletAccount } | null = null;

  const chains = (): IdentifierString[] =>
    client.getSolanaClusters().map((cluster) => SOLANA_CHAIN_BY_CLUSTER[cluster]);

  const accounts = (): WalletAccount[] => {
    const wallet = client.getWallet('solana');
    if (!wallet || disconnected) return [];
    const walletChains = chains();
    const key = `${wallet.address}|${walletChains.join(',')}`;
    if (cachedAccount?.key !== key) {
      // Same object while nothing changes, so apps can compare accounts by identity.
      const account: WalletAccount = Object.freeze({
        address: wallet.address,
        publicKey: base58ToBytes(wallet.address),
        chains: Object.freeze(walletChains),
        features: ACCOUNT_FEATURES,
      });
      cachedAccount = { key, account };
      return [account];
    }
    return [cachedAccount.account];
  };

  const emitChange = () => {
    for (const listener of [...(listeners.change ?? [])]) listener({ accounts: accounts() });
  };

  let lastKey = accounts()
    .map((account) => account.address)
    .join(',');
  const unsubscribe = client.subscribe(() => {
    const key = accounts()
      .map((account) => account.address)
      .join(',');
    if (key !== lastKey) {
      lastKey = key;
      emitChange();
    }
  });

  const requireAccount = (account: WalletAccount): string => {
    const current = client.getWallet('solana');
    if (!current || disconnected) {
      throw new PocketkeyEmbedError('not_authenticated', 'The Pocketkey wallet is not connected.');
    }
    if (account.address !== current.address) {
      throw new PocketkeyEmbedError('wallet_not_found', `Unknown account ${account.address}.`);
    }
    return current.address;
  };

  const clusterFor = (chain: IdentifierString | undefined): SolanaCluster | undefined => {
    if (chain === undefined) return undefined;
    const cluster = CLUSTER_BY_CHAIN[chain];
    if (!cluster) throw new PocketkeyEmbedError('unsupported', `Unsupported chain ${chain}.`);
    return cluster;
  };

  const connect: StandardConnectMethod = async (input) => {
    const wasDisconnected = disconnected;
    disconnected = false;
    if (!client.getWallet('solana') && !input?.silent) {
      if (!client.getSnapshot().user) await client.login();
      if (!client.getWallet('solana')) await client.createWallet('solana');
    }
    if (wasDisconnected && client.getWallet('solana')) {
      lastKey = accounts()
        .map((account) => account.address)
        .join(',');
      emitChange();
    }
    return { accounts: accounts() };
  };

  const disconnect: StandardDisconnectMethod = async () => {
    if (disconnected) return;
    disconnected = true;
    lastKey = '';
    emitChange();
  };

  const on: StandardEventsOnMethod = (event, listener) => {
    const set = (listeners[event] ??= new Set());
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  };

  const signMessage: SolanaSignMessageMethod = async (...inputs) => {
    const outputs = [];
    for (const input of inputs) {
      requireAccount(input.account);
      const { signature } = await client.signMessage({
        chain: 'solana',
        message: bytesToBase64(input.message),
      });
      outputs.push({ signedMessage: input.message, signature: base64ToBytes(signature) });
    }
    return outputs;
  };

  const signTransaction: SolanaSignTransactionMethod = async (...inputs) => {
    const outputs = [];
    for (const input of inputs) {
      requireAccount(input.account);
      const cluster = clusterFor(input.chain);
      const { signedTransaction } = await client.signTransaction({
        chain: 'solana',
        transaction: bytesToBase64(input.transaction),
        ...(cluster ? { cluster } : {}),
      });
      outputs.push({ signedTransaction: base64ToBytes(signedTransaction) });
    }
    return outputs;
  };

  const signAndSendTransaction: SolanaSignAndSendTransactionMethod = async (...inputs) => {
    const outputs = [];
    for (const input of inputs) {
      requireAccount(input.account);
      const cluster = clusterFor(input.chain);
      const { hash } = await client.sendTransaction({
        chain: 'solana',
        transaction: bytesToBase64(input.transaction),
        ...(cluster ? { cluster } : {}),
      });
      outputs.push({ signature: base58ToBytes(hash) });
    }
    return outputs;
  };

  const features: PocketkeyWalletFeatures = {
    'standard:connect': { version: '1.0.0', connect },
    'standard:disconnect': { version: '1.0.0', disconnect },
    'standard:events': { version: '1.0.0', on },
    'solana:signMessage': { version: '1.0.0', signMessage },
    'solana:signTransaction': {
      version: '1.0.0',
      supportedTransactionVersions: ['legacy', 0],
      signTransaction,
    },
    'solana:signAndSendTransaction': {
      version: '1.0.0',
      supportedTransactionVersions: ['legacy', 0],
      signAndSendTransaction,
    },
  };

  return {
    version: '1.0.0',
    name: 'Pocketkey',
    icon: POCKETKEY_WALLET_ICON,
    get chains() {
      return chains();
    },
    get accounts() {
      return accounts();
    },
    features,
    dispose: unsubscribe,
  };
}

class RegisterWalletEvent extends Event {
  readonly #detail: (api: WindowAppReadyEventAPI) => void;

  get detail() {
    return this.#detail;
  }

  constructor(callback: (api: WindowAppReadyEventAPI) => void) {
    super('wallet-standard:register-wallet', {
      bubbles: false,
      cancelable: false,
      composed: false,
    });
    this.#detail = callback;
  }
}

const hasRegisterApi = (event: Event): event is Event & { detail: WindowAppReadyEventAPI } => {
  const detail: unknown = (event as Event & { detail?: unknown }).detail;
  return (
    typeof detail === 'object' &&
    detail !== null &&
    'register' in detail &&
    typeof detail.register === 'function'
  );
};

/**
 * Same handshake as `registerWallet` from `@wallet-standard/wallet`, but keeps the unregister
 * callbacks the app hands back, so the wallet disappears when the provider unmounts.
 */
export function registerStandardWallet(wallet: Wallet): () => void {
  const unregisters: (() => void)[] = [];
  let active = true;
  const register = (api: WindowAppReadyEventAPI) => {
    if (active) unregisters.push(api.register(wallet));
  };
  const onAppReady = (event: Event) => {
    if (hasRegisterApi(event)) register(event.detail);
  };

  try {
    window.dispatchEvent(new RegisterWalletEvent(register));
  } catch (error) {
    console.error('wallet-standard:register-wallet event could not be dispatched\n', error);
  }
  window.addEventListener('wallet-standard:app-ready', onAppReady);

  return () => {
    active = false;
    window.removeEventListener('wallet-standard:app-ready', onAppReady);
    for (const unregister of unregisters.splice(0)) unregister();
  };
}
