import type { AuthResponse } from '@pocketkey/types';
import type { PocketkeyClient } from '@pocketkey/core';
import { EmbedFailure, userRejected } from './errors';
import { isRecord } from './guards';
import type { WalletOption } from './state';

/** Narrow EIP-1193 surface the embed uses. */
export interface Eip1193Provider {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
}

/** Narrow Phantom Solana surface the embed uses. */
export interface PhantomSolanaProvider {
  connect(): Promise<unknown>;
  signMessage(message: Uint8Array, display?: 'utf8' | 'hex'): Promise<unknown>;
}

export type DetectedProvider =
  | { family: 'evm'; provider: Eip1193Provider }
  | { family: 'solana'; provider: PhantomSolanaProvider };

export interface SignInContext {
  domain: string;
  uri: string;
  statement: string;
}

export type WalletAuthClient = Pick<
  PocketkeyClient['auth'],
  'getWalletNonce' | 'loginWithSiwe' | 'loginWithSiws'
>;

export interface WalletAdapter {
  discover(): Promise<WalletOption[]>;
  /** Rejects `user_rejected` when the user declines in the wallet. */
  login(auth: WalletAuthClient, walletId: string, context: SignInContext): Promise<AuthResponse>;
  /** Warms the lazily loaded signing code. */
  preload?(): void;
}

export function isEip1193Provider(value: unknown): value is Eip1193Provider {
  return isRecord(value) && typeof value.request === 'function';
}

export function isPhantomSolana(value: unknown): value is PhantomSolanaProvider {
  return (
    isRecord(value) &&
    typeof value.connect === 'function' &&
    typeof value.signMessage === 'function'
  );
}

function safeIcon(value: unknown): string | null {
  return typeof value === 'string' && /^data:image\/(svg\+xml|png|webp|jpeg|gif);/.test(value)
    ? value
    : null;
}

function injectedName(provider: Eip1193Provider): string {
  const flags = provider as unknown as Record<string, unknown>;
  if (flags.isRabby === true) return 'Rabby';
  if (flags.isCoinbaseWallet === true) return 'Coinbase Wallet';
  if (flags.isBraveWallet === true) return 'Brave Wallet';
  if (flags.isMetaMask === true) return 'MetaMask';
  return 'Browser wallet';
}

/** True for EIP-1193 4001, ethers `ACTION_REJECTED` and Phantom rejections. */
export function isWalletRejection(error: unknown): boolean {
  if (!isRecord(error)) return false;
  if (error.code === 4001 || error.code === 'ACTION_REJECTED') return true;
  const message = typeof error.message === 'string' ? error.message : '';
  return /user (rejected|denied|cancel)/i.test(message);
}

export function createBrowserWalletAdapter(win: Window, discoveryMs = 300): WalletAdapter {
  const providers = new Map<string, DetectedProvider>();
  const loadLogin = () => import('./wallet-login');

  return {
    preload() {
      void loadLogin();
    },

    async discover() {
      providers.clear();
      const options: WalletOption[] = [];
      const seen = new Set<string>();
      const onAnnounce = (event: Event) => {
        const detail: unknown = event instanceof CustomEvent ? event.detail : null;
        if (!isRecord(detail) || !isRecord(detail.info)) return;
        const { info, provider } = detail;
        if (typeof info.uuid !== 'string' || typeof info.name !== 'string') return;
        if (!isEip1193Provider(provider) || seen.has(info.uuid)) return;
        seen.add(info.uuid);
        const id = `eip6963:${info.uuid}`;
        providers.set(id, { family: 'evm', provider });
        options.push({
          id,
          name: info.name.slice(0, 40),
          icon: safeIcon(info.icon),
          family: 'evm',
        });
      };
      win.addEventListener('eip6963:announceProvider', onAnnounce);
      win.dispatchEvent(new Event('eip6963:requestProvider'));
      await new Promise((resolve) => setTimeout(resolve, discoveryMs));
      win.removeEventListener('eip6963:announceProvider', onAnnounce);

      const globals = win as unknown as { ethereum?: unknown; phantom?: unknown };
      if (options.length === 0 && isEip1193Provider(globals.ethereum)) {
        providers.set('injected', { family: 'evm', provider: globals.ethereum });
        options.push({
          id: 'injected',
          name: injectedName(globals.ethereum),
          icon: null,
          family: 'evm',
        });
      }
      const phantom = isRecord(globals.phantom) ? globals.phantom.solana : undefined;
      if (isPhantomSolana(phantom)) {
        providers.set('phantom:solana', { family: 'solana', provider: phantom });
        options.push({ id: 'phantom:solana', name: 'Phantom', icon: null, family: 'solana' });
      }
      return options;
    },

    async login(auth, walletId, context) {
      const detected = providers.get(walletId);
      if (!detected)
        throw new EmbedFailure('wallet_not_found', 'That wallet is no longer available.');
      const { signInWithEvm, signInWithSolana } = await loadLogin();
      try {
        return detected.family === 'evm'
          ? await signInWithEvm(auth, detected.provider, context)
          : await signInWithSolana(auth, detected.provider, context);
      } catch (error) {
        if (isWalletRejection(error))
          throw userRejected('The request was cancelled in the wallet.');
        throw error;
      }
    },
  };
}
