import type {
  ChainFamily,
  EmbedError,
  PublicAppConfig,
  SendTransactionInput,
  SignMessageInput,
  SignTypedDataInput,
  SigningPolicy,
  TransactionRequest,
  Wallet,
} from '@pockey/types';
import { createStore, type Store } from './store';

export type OAuthProvider = 'google' | 'apple';

/** A browser wallet found by discovery. Serializable: the provider object stays in the adapter. */
export interface WalletOption {
  id: string;
  name: string;
  /** `data:image/...` URI announced by the wallet, or null. */
  icon: string | null;
  family: ChainFamily;
}

export type ConfirmStatus = 'idle' | 'pending' | 'error';

export type Screen =
  | { name: 'login' }
  | {
      name: 'emailCode';
      email: string;
      status: 'sending' | 'idle' | 'verifying';
      error: string | null;
      /** Epoch ms when resending becomes available. 0 means now. */
      resendAt: number;
      /** Bumped to clear the code boxes. */
      resetKey: number;
    }
  | {
      name: 'passkey';
      mode: 'login' | 'register';
      status: 'waiting' | 'failed';
      message: string | null;
    }
  | {
      name: 'oauth';
      provider: OAuthProvider;
      status: 'waiting' | 'blocked' | 'error';
      message: string | null;
    }
  | { name: 'wallets'; status: 'discovering' | 'ready'; options: WalletOption[] }
  | {
      name: 'walletConfirm';
      wallet: WalletOption;
      status: 'waiting' | 'cancelled' | 'error';
      message: string | null;
    }
  | { name: 'success'; title: string }
  | {
      name: 'signMessage';
      origin: string;
      wallet: Wallet;
      input: SignMessageInput;
      status: ConfirmStatus;
      error: EmbedError | null;
    }
  | {
      name: 'signTypedData';
      origin: string;
      wallet: Wallet;
      input: SignTypedDataInput;
      status: ConfirmStatus;
      error: EmbedError | null;
    }
  | {
      name: 'transaction';
      kind: 'sign' | 'send';
      origin: string;
      wallet: Wallet;
      input: TransactionRequest | SendTransactionInput;
      status: ConfirmStatus;
      error: EmbedError | null;
    }
  | {
      /** Session signer consent (`createSession`). */
      name: 'session';
      origin: string;
      wallet: Wallet;
      policy: SigningPolicy;
      /** Epoch ms the session would expire if allowed now. */
      expiresAt: number;
      status: ConfirmStatus;
      error: EmbedError | null;
    }
  | {
      name: 'export';
      wallet: Wallet;
      status: 'idle' | 'revealing' | 'revealed' | 'simulated' | 'error';
      privateKey: string | null;
      error: EmbedError | null;
    }
  | { name: 'error'; error: EmbedError };

export type ScreenName = Screen['name'];
export type ScreenOf<N extends ScreenName> = Extract<Screen, { name: N }>;
export type ConfirmScreen = ScreenOf<'signMessage' | 'signTypedData' | 'transaction' | 'session'>;

export function isScreen<N extends ScreenName>(
  screen: Screen | null,
  name: N,
): screen is ScreenOf<N> {
  return screen !== null && screen.name === name;
}

export function isConfirmScreen(screen: Screen | null): screen is ConfirmScreen {
  return (
    screen !== null &&
    (screen.name === 'signMessage' ||
      screen.name === 'signTypedData' ||
      screen.name === 'transaction' ||
      screen.name === 'session')
  );
}

export interface Nav {
  /** Bumped on every screen change, keys the screen transition. */
  key: number;
  direction: 1 | -1;
  /** The change was keyboard initiated: opacity only. */
  keyboard: boolean;
}

export interface EmbedState {
  phase: 'closed' | 'open' | 'closing';
  screen: Screen | null;
  nav: Nav;
  /** Effective config: server config narrowed and overridden by `init`. */
  config: PublicAppConfig | null;
  /** Origin of the host page, set on the first accepted request. */
  hostOrigin: string | null;
  /** The close was keyboard initiated: opacity only. */
  closeKeyboard: boolean;
}

export type EmbedStore = Store<EmbedState>;

export function createEmbedStore(): EmbedStore {
  return createStore<EmbedState>({
    phase: 'closed',
    screen: null,
    nav: { key: 0, direction: 1, keyboard: false },
    config: null,
    hostOrigin: null,
    closeKeyboard: false,
  });
}

/** Everything a screen can ask for. Screens never call the client themselves. */
export interface ScreenActions {
  /** Escape, backdrop, close button. */
  dismiss: () => void;
  back: () => void;
  submitEmail: (email: string) => void;
  verifyCode: (code: string) => void;
  resendCode: () => void;
  /** Must be called synchronously from the click handler (popup). */
  loginWithOAuth: (provider: OAuthProvider) => void;
  loginWithPasskey: () => void;
  openWallets: () => void;
  chooseWallet: (id: string) => void;
  /** Try again on passkey, OAuth, wallet and wallet list screens. */
  retry: () => void;
  approve: () => void;
  /** Cancel button on confirmation screens. */
  cancel: () => void;
  reveal: () => void;
  /** Done or Close button. */
  finish: () => void;
}

export const noopActions: ScreenActions = {
  dismiss: () => undefined,
  back: () => undefined,
  submitEmail: () => undefined,
  verifyCode: () => undefined,
  resendCode: () => undefined,
  loginWithOAuth: () => undefined,
  loginWithPasskey: () => undefined,
  openWallets: () => undefined,
  chooseWallet: () => undefined,
  retry: () => undefined,
  approve: () => undefined,
  cancel: () => undefined,
  reveal: () => undefined,
  finish: () => undefined,
};
