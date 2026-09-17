import {
  EvmChainId,
  type ChainFamily,
  type CreateSessionInput,
  type EndUser,
  type EvmTransactionRequest,
  type HostResponseDataMap,
  type PublicAppConfig,
  type SessionSigner,
  type SessionSignOutput,
  type SessionSignRequestInput,
  type SignMessageInput,
  type SignTypedDataInput,
  type SolanaCluster,
  type SolanaTransactionRequest,
  type Wallet,
} from '@pocketkey/types';
import type { z } from 'zod';
import {
  createEmbedBridge,
  type EmbedBridge,
  type EmbedInitOptions,
  type HostRequestPayload,
} from './bridge.js';
import { resolveEvmChains, resolveSolanaClusters, type PocketkeyConfig } from './config.js';
import { PocketkeyEmbedError } from './errors.js';
import { createEvmProvider, type EIP1193Provider } from './evm-provider.js';

/* Public input types: the wire schemas' input shapes, with chainId and cluster defaulting to the current selection. */

type EvmTransactionWire = z.input<typeof EvmTransactionRequest>;
type SolanaTransactionWire = z.input<typeof SolanaTransactionRequest>;

export type EvmTransactionParams = Omit<EvmTransactionWire, 'chainId'> & {
  /** Defaults to the selected chain. */
  chainId?: number;
};
export type SolanaTransactionParams = Omit<SolanaTransactionWire, 'cluster'> & {
  /** Defaults to the first configured cluster. */
  cluster?: SolanaCluster;
};
export type TransactionParams = EvmTransactionParams | SolanaTransactionParams;
export type SendTransactionParams = TransactionParams & { sponsored?: boolean };
export type SignMessageParams = z.input<typeof SignMessageInput>;
export type SignTypedDataParams = z.input<typeof SignTypedDataInput>;
/** `CreateSessionInput` with plain strings for ids and addresses (validated by the embed). */
export type CreateSessionParams = z.input<typeof CreateSessionInput>;
/** What to sign under a session: `{ kind: 'message' | 'typedData' | 'transaction', input }`. */
export type SessionSignParams = SessionSignRequestInput;

export interface SessionsSnapshot {
  /** Newest first, including revoked and expired sessions. */
  sessions: SessionSigner[];
  loading: boolean;
  /** A load already started for the current user: the lazy load runs once per user. */
  requested: boolean;
}

const NO_SESSIONS: SessionsSnapshot = { sessions: [], loading: false, requested: false };

type SessionsPatch = (sessions: SessionSigner[]) => SessionSigner[];

/** Replaces the session with the same id, or puts it first (newest). */
export function upsertSession(sessions: SessionSigner[], session: SessionSigner): SessionSigner[] {
  return sessions.some((candidate) => candidate.id === session.id)
    ? sessions.map((candidate) => (candidate.id === session.id ? session : candidate))
    : [session, ...sessions];
}

export function markSessionRevoked(
  sessions: SessionSigner[],
  sessionId: string,
  revokedAt: string,
): SessionSigner[] {
  return sessions.map((session) =>
    session.id === sessionId && session.revokedAt === null ? { ...session, revokedAt } : session,
  );
}

/** A chain family (`evm`, `solana`) or a wallet id (`wlt_...`). String autocomplete kept for the families. */
export type WalletRef = ChainFamily | (string & Record<never, never>);

export interface SignOptions {
  /** When false the embed signs without a confirmation screen. Defaults to true. */
  confirm?: boolean;
}

export interface LoginOptions {
  method?: HostRequestPayload<'login'>['method'];
  email?: string;
}

export interface ClientSnapshot {
  /** True once the embed answered `init`. */
  ready: boolean;
  user: EndUser | null;
  serverConfig: PublicAppConfig | null;
  /** Chain picked through `switchChain`. Null means the first configured chain. */
  selectedChainId: number | null;
  /** Sticky: a Solana wallet was seen during this provider's lifetime. */
  solanaSeen: boolean;
}

export interface MountOptions {
  appId: string;
  embedUrl: string;
  container?: HTMLElement;
  readyTimeoutMs?: number;
}

export function findWallet(user: EndUser | null, family: ChainFamily): Wallet | null {
  return user?.wallets.find((wallet) => wallet.chainFamily === family) ?? null;
}

export function selectChainId(
  config: PocketkeyConfig | undefined,
  snapshot: Pick<ClientSnapshot, 'serverConfig' | 'selectedChainId'>,
): number {
  const chains = resolveEvmChains(config, snapshot.serverConfig);
  const selected = snapshot.selectedChainId;
  if (selected !== null && chains.includes(selected)) return selected;
  return chains[0] ?? 8453;
}

export function selectCluster(
  config: PocketkeyConfig | undefined,
  snapshot: Pick<ClientSnapshot, 'serverConfig'>,
): SolanaCluster {
  return resolveSolanaClusters(config, snapshot.serverConfig)[0] ?? 'mainnet-beta';
}

const notAuthenticated = () =>
  new PocketkeyEmbedError('not_authenticated', 'No Pocketkey user is logged in.');

/**
 * Framework-free state and actions behind `PocketkeyProvider`. One client per provider
 * instance; `mount` creates the iframe bridge and returns its teardown, so React StrictMode
 * double effects destroy the first bridge before creating the second.
 */
export class PocketkeyClient {
  #snapshot: ClientSnapshot = {
    ready: false,
    user: null,
    serverConfig: null,
    selectedChainId: null,
    solanaSeen: false,
  };
  #listeners = new Set<() => void>();
  #bridge: EmbedBridge | null = null;
  #config: PocketkeyConfig | undefined;
  #onError: ((error: PocketkeyEmbedError) => void) | undefined;
  #evmProvider: EIP1193Provider | null = null;
  #sessions: SessionsSnapshot = NO_SESSIONS;
  #sessionListeners = new Set<() => void>();
  /** Bumped when the user changes: late results for the previous user are dropped. */
  #sessionsGeneration = 0;
  #sessionsLoad: Promise<SessionSigner[]> | null = null;
  /** Creations and revocations made while a load is in flight, replayed over its result. */
  #sessionsPatches: SessionsPatch[] = [];

  constructor(config?: PocketkeyConfig) {
    this.#config = config;
  }

  /* Store */

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  getSnapshot = (): ClientSnapshot => this.#snapshot;

  #update(patch: Partial<ClientSnapshot>): void {
    const previousUserId = this.#snapshot.user?.id ?? null;
    const next = { ...this.#snapshot, ...patch };
    if (findWallet(next.user, 'solana')) next.solanaSeen = true;
    this.#snapshot = next;
    if ((next.user?.id ?? null) !== previousUserId) this.#resetSessions();
    for (const listener of [...this.#listeners]) listener();
  }

  subscribeSessions = (listener: () => void): (() => void) => {
    this.#sessionListeners.add(listener);
    return () => {
      this.#sessionListeners.delete(listener);
    };
  };

  getSessionsSnapshot = (): SessionsSnapshot => this.#sessions;

  #setSessions(patch: Partial<SessionsSnapshot>): void {
    this.#sessions = { ...this.#sessions, ...patch };
    for (const listener of [...this.#sessionListeners]) listener();
  }

  #patchSessions(patch: SessionsPatch): void {
    if (this.#sessionsLoad) this.#sessionsPatches.push(patch);
    this.#setSessions({ sessions: patch(this.#sessions.sessions) });
  }

  #resetSessions(): void {
    this.#sessionsGeneration += 1;
    this.#sessionsLoad = null;
    this.#sessionsPatches = [];
    if (this.#sessions === NO_SESSIONS) return;
    this.#sessions = NO_SESSIONS;
    for (const listener of [...this.#sessionListeners]) listener();
  }

  setConfig(config: PocketkeyConfig | undefined): void {
    this.#config = config;
  }

  get config(): PocketkeyConfig | undefined {
    return this.#config;
  }

  setOnError(onError: ((error: PocketkeyEmbedError) => void) | undefined): void {
    this.#onError = onError;
  }

  getBridge(): EmbedBridge | null {
    return this.#bridge;
  }

  mount(options: MountOptions): () => void {
    const init: EmbedInitOptions = {};
    if (this.#config?.appearance) init.appearance = this.#config.appearance;
    if (this.#config?.loginMethods) init.loginMethods = this.#config.loginMethods;

    const bridge = createEmbedBridge({
      appId: options.appId,
      embedUrl: options.embedUrl,
      init,
      ...(options.container ? { container: options.container } : {}),
      ...(options.readyTimeoutMs !== undefined ? { readyTimeoutMs: options.readyTimeoutMs } : {}),
    });
    this.#bridge = bridge;
    bridge.onInit((result) => {
      this.#update({ ready: true, user: result.user, serverConfig: result.config });
    });
    bridge.onAuthChanged((user) => {
      this.#update({ user });
    });
    bridge.onError((error) => {
      this.#onError?.(error);
    });

    return () => {
      bridge.destroy();
      if (this.#bridge === bridge) {
        this.#bridge = null;
        this.#update({ ready: false, user: null });
      }
    };
  }

  #request<T extends Parameters<EmbedBridge['request']>[0]>(
    type: T,
    payload: HostRequestPayload<T>,
  ): Promise<HostResponseDataMap[T]> {
    const bridge = this.#bridge;
    if (!bridge) {
      return Promise.reject(
        new PocketkeyEmbedError('not_ready', 'PocketkeyProvider is not mounted.'),
      );
    }
    return bridge.request(type, payload);
  }

  /* Derived state */

  getChainId(): number {
    return selectChainId(this.#config, this.#snapshot);
  }

  getEvmChains(): number[] {
    return resolveEvmChains(this.#config, this.#snapshot.serverConfig);
  }

  getSolanaClusters(): SolanaCluster[] {
    return resolveSolanaClusters(this.#config, this.#snapshot.serverConfig);
  }

  getWallet(family: ChainFamily): Wallet | null {
    return findWallet(this.#snapshot.user, family);
  }

  #requireWallet(family: ChainFamily): Wallet {
    if (!this.#snapshot.user) throw notAuthenticated();
    const wallet = this.getWallet(family);
    if (!wallet) {
      throw new PocketkeyEmbedError('wallet_not_found', `The user has no ${family} wallet.`);
    }
    return wallet;
  }

  /* Auth */

  login = async (options: LoginOptions = {}): Promise<EndUser> => {
    const payload: HostRequestPayload<'login'> = {};
    if (options.method !== undefined) payload.method = options.method;
    if (options.email !== undefined) payload.email = options.email;
    const { user } = await this.#request('login', payload);
    this.#update({ user });
    return user;
  };

  logout = async (): Promise<void> => {
    await this.#request('logout', {});
    this.#update({ user: null });
  };

  registerPasskey = async (): Promise<EndUser> => {
    const { user } = await this.#request('registerPasskey', {});
    this.#update({ user });
    return user;
  };

  /* Wallets */

  createWallet = async (chainFamily: ChainFamily): Promise<Wallet> => {
    const wallet = await this.#request('createWallet', { chainFamily });
    const user = this.#snapshot.user;
    if (user) {
      this.#update({
        user: { ...user, wallets: [...user.wallets.filter((w) => w.id !== wallet.id), wallet] },
      });
    }
    return wallet;
  };

  exportWallet = async (chainFamilyOrWalletId: WalletRef): Promise<void> => {
    const ref: string = chainFamilyOrWalletId;
    const walletId = ref === 'evm' || ref === 'solana' ? this.#requireWallet(ref).id : ref;
    await this.#request('exportWallet', { walletId });
  };

  switchChain = async (chainId: number): Promise<void> => {
    if (!this.getEvmChains().includes(chainId)) {
      throw new PocketkeyEmbedError(
        'chain_not_configured',
        `Chain ${chainId} is not in the configured EVM chains.`,
      );
    }
    if (this.getChainId() !== chainId) this.#update({ selectedChainId: chainId });
  };

  /* Signing */

  signMessage = async (input: SignMessageParams, options: SignOptions = {}) => {
    const wallet = this.#requireWallet(input.chain);
    return this.#request('signMessage', { walletId: wallet.id, input, ...confirmField(options) });
  };

  signTypedData = async (input: SignTypedDataParams, options: SignOptions = {}) => {
    const wallet = this.#requireWallet('evm');
    return this.#request('signTypedData', { walletId: wallet.id, input, ...confirmField(options) });
  };

  signTransaction = async (input: TransactionParams, options: SignOptions = {}) => {
    const wallet = this.#requireWallet(input.chain);
    return this.#request('signTransaction', {
      walletId: wallet.id,
      input: this.#completeTransaction(input),
      ...confirmField(options),
    });
  };

  sendTransaction = async (input: SendTransactionParams, options: SignOptions = {}) => {
    const wallet = this.#requireWallet(input.chain);
    return this.#request('sendTransaction', {
      walletId: wallet.id,
      input: {
        ...this.#completeTransaction(input),
        ...(input.sponsored !== undefined ? { sponsored: input.sponsored } : {}),
      },
      ...confirmField(options),
    });
  };

  /* Session signers */

  /** Loads the sessions once per signed-in user. Failures stay silent: `refreshSessions` retries. */
  loadSessionsOnce = (): void => {
    if (!this.#snapshot.user || this.#sessions.requested) return;
    this.refreshSessions().catch(() => undefined);
  };

  refreshSessions = (): Promise<SessionSigner[]> => {
    if (!this.#snapshot.user) return Promise.reject(notAuthenticated());
    if (this.#sessionsLoad) return this.#sessionsLoad;
    const generation = this.#sessionsGeneration;
    this.#sessionsPatches = [];
    const load = this.#request('listSessions', {}).then(
      ({ sessions }) => {
        if (generation !== this.#sessionsGeneration) return sessions;
        const merged = this.#sessionsPatches.reduce((list, patch) => patch(list), sessions);
        this.#sessionsLoad = null;
        this.#sessionsPatches = [];
        this.#setSessions({ sessions: merged, loading: false });
        return merged;
      },
      (error: unknown) => {
        if (generation === this.#sessionsGeneration) {
          this.#sessionsLoad = null;
          this.#sessionsPatches = [];
          this.#setSessions({ loading: false });
        }
        throw error;
      },
    );
    this.#sessionsLoad = load;
    this.#setSessions({ loading: true, requested: true });
    return load;
  };

  /** Opens the consent screen. Resolves once the user allowed and the session exists. */
  createSession = async (input: CreateSessionParams): Promise<SessionSigner> => {
    if (!this.#snapshot.user) throw notAuthenticated();
    const generation = this.#sessionsGeneration;
    const session = await this.#request('createSession', { input });
    if (generation === this.#sessionsGeneration) {
      this.#patchSessions((sessions) => upsertSession(sessions, session));
    }
    return session;
  };

  revokeSession = async (sessionId: string): Promise<void> => {
    if (!this.#snapshot.user) throw notAuthenticated();
    const generation = this.#sessionsGeneration;
    await this.#request('revokeSession', { sessionId });
    if (generation !== this.#sessionsGeneration) return;
    const revokedAt = new Date().toISOString();
    this.#patchSessions((sessions) => markSessionRevoked(sessions, sessionId, revokedAt));
  };

  /** Signs without any UI. The session policy is enforced by the API and the key provider. */
  signWithSession = async (
    sessionId: string,
    request: SessionSignParams,
  ): Promise<SessionSignOutput> => {
    if (!this.#snapshot.user) throw notAuthenticated();
    return this.#request('signWithSession', { sessionId, request });
  };

  #completeTransaction(input: TransactionParams): EvmTransactionWire | SolanaTransactionWire {
    if (input.chain === 'solana') {
      return { ...input, cluster: input.cluster ?? selectCluster(this.#config, this.#snapshot) };
    }
    const chainId = input.chainId ?? this.getChainId();
    const parsed = EvmChainId.safeParse(chainId);
    if (!parsed.success) {
      throw new PocketkeyEmbedError(
        'unsupported',
        `Chain ${chainId} is not supported by Pocketkey.`,
      );
    }
    return { ...input, chainId: parsed.data };
  }

  /* Interop */

  getEvmProvider = (): EIP1193Provider => {
    this.#evmProvider ??= createEvmProvider(this);
    return this.#evmProvider;
  };
}

function confirmField(options: SignOptions): { confirm?: boolean } {
  return options.confirm === undefined ? {} : { confirm: options.confirm };
}
