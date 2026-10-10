import type { PockeyClient } from '@pockey/core';
import {
  durationToSeconds,
  type EmbedError,
  type EndUser,
  type HostRequest,
  type HostResponseDataMap,
  type PublicAppConfig,
  type Wallet,
} from '@pockey/types';
import { appDisplayName, effectiveConfig } from './config';
import { EmbedFailure, toEmbedError, toFailure, userRejected } from './errors';
import { isKeyboardModality } from './modality';
import type { RequestContext } from './messenger';
import {
  isConfirmScreen,
  isScreen,
  type ConfirmStatus,
  type EmbedStore,
  type OAuthProvider,
  type Screen,
  type ScreenActions,
  type ScreenName,
  type ScreenOf,
} from './state';
import type { WalletAdapter } from './wallets';

export type EmbedClient = Pick<
  PockeyClient,
  'ready' | 'getConfig' | 'auth' | 'wallets' | 'sessions'
>;

export interface ControllerDeps {
  client: EmbedClient;
  store: EmbedStore;
  wallets?: WalletAdapter;
  /** The embed's own location, used for SIWE and SIWS. */
  location?: { host: string; origin: string };
  isKeyboard?: () => boolean;
  successDelayMs?: number;
  resendSeconds?: number;
  now?: () => number;
}

export interface Controller {
  handle: (request: HostRequest, context: RequestContext) => Promise<unknown>;
  actions: ScreenActions;
}

type TaskKind = 'login' | 'confirm' | 'export' | 'register';

/** One interactive request: owns the dialog until it settles. */
class Task<T> {
  settled = false;
  /** Ignores dismissal: a call is in flight or the success screen is showing. */
  locked = false;
  /** Set once the result is known and only the success screen remains. */
  successValue: T | null = null;
  onDismiss: () => void;
  approve: (() => void) | null = null;
  readonly promise: Promise<T>;
  private resolveFn: (value: T) => void = () => undefined;
  private rejectFn: (error: EmbedFailure) => void = () => undefined;

  constructor(readonly kind: TaskKind) {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolveFn = resolve;
      this.rejectFn = reject;
    });
    this.onDismiss = () => {
      this.reject(userRejected());
    };
  }

  resolve(value: T): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveFn(value);
  }

  reject(error: EmbedFailure): void {
    if (this.settled) return;
    this.settled = true;
    this.rejectFn(error);
  }
}

interface ActiveTask {
  readonly kind: TaskKind;
  settled: boolean;
  locked: boolean;
  onDismiss: () => void;
  approve: (() => void) | null;
  reject(error: EmbedFailure): void;
  finishWithSuccess(): boolean;
}

const INVALID_CODE = 'That code is not valid. Try again.';
const INVALID_CODE_ERRORS = new Set(['bad_request', 'unauthorized', 'validation_failed']);

export function createController(deps: ControllerDeps): Controller {
  const { client, store } = deps;
  const isKeyboard = deps.isKeyboard ?? isKeyboardModality;
  const successDelayMs = deps.successDelayMs ?? 600;
  const resendMs = (deps.resendSeconds ?? 30) * 1000;
  const now = deps.now ?? (() => Date.now());
  const location = deps.location ?? { host: window.location.host, origin: window.location.origin };

  let config: PublicAppConfig | null = null;
  let active: ActiveTask | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  let walletOptions: ScreenOf<'wallets'>['options'] = [];

  /* Config */

  async function ensureConfig(): Promise<PublicAppConfig> {
    if (config) return config;
    const server = await client.getConfig();
    config ??= server;
    store.set({ config });
    return config;
  }

  /* Dialog and screens */

  function navigate(screen: Screen, direction: 1 | -1 = 1): number {
    const key = store.get().nav.key + 1;
    store.set({ screen, phase: 'open', nav: { key, direction, keyboard: isKeyboard() } });
    return key;
  }

  function patch<N extends ScreenName>(
    key: number,
    name: N,
    update: (screen: ScreenOf<N>) => ScreenOf<N>,
  ): boolean {
    const state = store.get();
    if (state.nav.key !== key || !isScreen(state.screen, name)) return false;
    store.set({ screen: update(state.screen) });
    return true;
  }

  function closeDialog(): void {
    if (store.get().phase !== 'open') return;
    store.set({ phase: 'closing', closeKeyboard: isKeyboard() });
  }

  function interactive<T>(kind: TaskKind, start: (task: Task<T>) => void): Promise<T> {
    const run = async (): Promise<T> => {
      const task = new Task<T>(kind);
      const handle: ActiveTask = {
        kind,
        get settled() {
          return task.settled;
        },
        get locked() {
          return task.locked;
        },
        set locked(value: boolean) {
          task.locked = value;
        },
        get onDismiss() {
          return task.onDismiss;
        },
        get approve() {
          return task.approve;
        },
        reject: (error) => {
          task.reject(error);
        },
        finishWithSuccess: () => {
          if (task.successValue === null) return false;
          task.resolve(task.successValue);
          return true;
        },
      };
      active = handle;
      try {
        start(task);
      } catch (error) {
        task.reject(toFailure(error));
      }
      try {
        return await task.promise;
      } finally {
        if (active === handle) active = null;
        closeDialog();
      }
    };
    const result = queue.then(run);
    queue = result.catch(() => undefined);
    return result;
  }

  function succeed<T>(task: Task<T>, title: string, value: T): void {
    if (task.settled || task.successValue !== null) return;
    task.locked = true;
    task.successValue = value;
    navigate({ name: 'success', title });
    setTimeout(() => {
      task.resolve(value);
    }, successDelayMs);
  }

  /* Auth helpers */

  async function currentUser(): Promise<EndUser | null> {
    await client.ready();
    const cached = client.auth.getUser();
    if (cached) return cached;
    if (!client.auth.isAuthenticated()) return null;
    return client.auth.refreshUser();
  }

  async function requireWallet(walletId: string): Promise<Wallet> {
    await client.ready();
    if (!client.auth.isAuthenticated()) {
      throw new EmbedFailure('not_authenticated', 'Log in before using a wallet.');
    }
    const user = await currentUser();
    if (!user) throw new EmbedFailure('not_authenticated', 'Log in before using a wallet.');
    const wallet = user.wallets.find((candidate) => candidate.id === walletId);
    if (!wallet) {
      throw new EmbedFailure('wallet_not_found', 'This wallet does not belong to the user.');
    }
    return wallet;
  }

  /* Login flows */

  let loginTask: Task<HostResponseDataMap['login']> | null = null;

  function activeLogin(): Task<HostResponseDataMap['login']> | null {
    return loginTask && !loginTask.settled && !loginTask.locked ? loginTask : null;
  }

  function loginSucceeded(user: EndUser): void {
    const task = loginTask;
    if (!task || task.settled) return;
    succeed(task, 'You are in', { user });
  }

  function sendCode(key: number, email: string): void {
    client.auth.sendEmailCode(email).then(
      () => {
        patch(key, 'emailCode', (screen) => ({
          ...screen,
          status: screen.status === 'sending' ? 'idle' : screen.status,
        }));
      },
      (error: unknown) => {
        patch(key, 'emailCode', (screen) => ({
          ...screen,
          status: screen.status === 'sending' ? 'idle' : screen.status,
          error: toEmbedError(error).message,
          resendAt: 0,
        }));
      },
    );
  }

  function startEmail(email: string): void {
    const key = navigate({
      name: 'emailCode',
      email,
      status: 'sending',
      error: null,
      resendAt: now() + resendMs,
      resetKey: 0,
    });
    sendCode(key, email);
  }

  function startPasskeyLogin(): void {
    const state = store.get();
    const key = isScreen(state.screen, 'passkey')
      ? state.nav.key
      : navigate({ name: 'passkey', mode: 'login', status: 'waiting', message: null });
    patch(key, 'passkey', (screen) => ({ ...screen, status: 'waiting', message: null }));
    client.auth.passkey.login().then(
      (response) => {
        loginSucceeded(response.user);
      },
      (error: unknown) => {
        const { code, message } = toEmbedError(error);
        patch(key, 'passkey', (screen) => ({
          ...screen,
          status: 'failed',
          message: code === 'user_rejected' ? null : message,
        }));
      },
    );
  }

  function startOAuth(provider: OAuthProvider): void {
    let pending: Promise<{ user: EndUser }>;
    try {
      // Synchronous: the popup must open inside the click that called this.
      pending = client.auth.oauth.loginWithPopup(provider);
    } catch (error) {
      pending = Promise.reject(toFailure(error));
    }
    const state = store.get();
    const key =
      isScreen(state.screen, 'oauth') && state.screen.provider === provider
        ? state.nav.key
        : navigate({ name: 'oauth', provider, status: 'waiting', message: null });
    patch(key, 'oauth', (screen) => ({ ...screen, status: 'waiting', message: null }));
    pending.then(
      (response) => {
        loginSucceeded(response.user);
      },
      (error: unknown) => {
        const { code, message } = toEmbedError(error);
        if (code === 'popup_blocked') {
          patch(key, 'oauth', (screen) => ({ ...screen, status: 'blocked', message: null }));
        } else if (code === 'user_rejected') {
          const current = store.get();
          if (current.nav.key === key && activeLogin()) navigate({ name: 'login' }, -1);
        } else {
          patch(key, 'oauth', (screen) => ({ ...screen, status: 'error', message }));
        }
      },
    );
  }

  function discoverWallets(): void {
    const adapter = deps.wallets;
    const state = store.get();
    const key = isScreen(state.screen, 'wallets')
      ? state.nav.key
      : navigate({ name: 'wallets', status: 'discovering', options: [] });
    patch(key, 'wallets', (screen) => ({ ...screen, status: 'discovering' }));
    if (!adapter) {
      patch(key, 'wallets', (screen) => ({ ...screen, status: 'ready', options: [] }));
      return;
    }
    adapter.preload?.();
    adapter.discover().then(
      (options) => {
        walletOptions = options;
        patch(key, 'wallets', (screen) => ({ ...screen, status: 'ready', options }));
      },
      () => {
        walletOptions = [];
        patch(key, 'wallets', (screen) => ({ ...screen, status: 'ready', options: [] }));
      },
    );
  }

  function signInWithWallet(key: number, walletId: string): void {
    const adapter = deps.wallets;
    const cfg = config;
    if (!adapter || !cfg) return;
    patch(key, 'walletConfirm', (screen) => ({ ...screen, status: 'waiting', message: null }));
    adapter
      .login(client.auth, walletId, {
        domain: location.host,
        uri: location.origin,
        statement: `Sign in to ${appDisplayName(cfg)} with Pockey`,
      })
      .then(
        (response) => {
          loginSucceeded(response.user);
        },
        (error: unknown) => {
          const { code, message } = toEmbedError(error);
          patch(key, 'walletConfirm', (screen) => ({
            ...screen,
            status: code === 'user_rejected' ? 'cancelled' : 'error',
            message: code === 'user_rejected' ? null : message,
          }));
        },
      );
  }

  async function login(request: Extract<HostRequest, { type: 'login' }>) {
    const cfg = await ensureConfig();
    const existing = await currentUser();
    if (existing) return { user: existing };
    return interactive<HostResponseDataMap['login']>('login', (task) => {
      const user = client.auth.getUser();
      if (user) {
        task.resolve({ user });
        return;
      }
      loginTask = task;
      const method =
        request.method && cfg.loginMethods.includes(request.method) ? request.method : undefined;
      if (method === 'email' && request.email) startEmail(request.email);
      else if (method === 'passkey') startPasskeyLogin();
      else if (method === 'google' || method === 'apple') startOAuth(method);
      else if (method === 'wallet') discoverWallets();
      else navigate({ name: 'login' });
    });
  }

  /* Confirmation flows */

  function confirm<T>(screen: Screen, call: () => Promise<T>): Promise<T> {
    return interactive<T>('confirm', (task) => {
      const key = navigate(screen);
      task.approve = () => {
        const current = store.get().screen;
        if (task.settled || task.locked || !isConfirmScreen(current)) return;
        task.locked = true;
        const update = (next: { status: ConfirmStatus; error: EmbedError | null }) => {
          const state = store.get();
          if (state.nav.key !== key || !isConfirmScreen(state.screen)) return;
          store.set({ screen: { ...state.screen, ...next } });
        };
        update({ status: 'pending', error: null });
        call().then(
          (result) => {
            task.resolve(result);
          },
          (error: unknown) => {
            task.locked = false;
            update({ status: 'error', error: toEmbedError(error) });
          },
        );
      };
    });
  }

  /* Export */

  function exportWallet(wallet: Wallet) {
    return interactive<HostResponseDataMap['exportWallet']>('export', (task) => {
      task.onDismiss = () => {
        task.resolve({ ok: true });
      };
      const key = navigate({
        name: 'export',
        wallet,
        status: 'idle',
        privateKey: null,
        error: null,
      });
      task.approve = () => {
        if (task.settled || task.locked) return;
        task.locked = true;
        patch(key, 'export', (screen) => ({ ...screen, status: 'revealing', error: null }));
        // Encrypted by the key provider to a one-time key of this iframe, decrypted
        // here: the API only ever relays ciphertext (section 8.4).
        void (async (): Promise<string | null> => {
          const { privateKey } = await client.wallets.exportWallet(wallet.id);
          return privateKey;
        })().then(
          (privateKey) => {
            task.locked = false;
            patch(key, 'export', (screen) => ({
              ...screen,
              status: privateKey === null ? 'simulated' : 'revealed',
              privateKey,
            }));
          },
          (error: unknown) => {
            task.locked = false;
            patch(key, 'export', (screen) => ({
              ...screen,
              status: 'error',
              error: toEmbedError(error),
            }));
          },
        );
      };
    });
  }

  /* Passkey registration */

  function registerPasskey() {
    return interactive<HostResponseDataMap['registerPasskey']>('register', (task) => {
      const run = (key: number) => {
        patch(key, 'passkey', (screen) => ({ ...screen, status: 'waiting', message: null }));
        client.auth.passkey.register().then(
          (user) => {
            succeed(task, 'Passkey added', { user });
          },
          (error: unknown) => {
            const { code, message } = toEmbedError(error);
            patch(key, 'passkey', (screen) => ({
              ...screen,
              status: 'failed',
              message: code === 'user_rejected' ? null : message,
            }));
          },
        );
      };
      const key = navigate({ name: 'passkey', mode: 'register', status: 'waiting', message: null });
      task.approve = () => {
        if (!task.settled && !task.locked) run(store.get().nav.key);
      };
      run(key);
    });
  }

  /* Requests */

  async function handle(request: HostRequest, context: RequestContext): Promise<unknown> {
    if (store.get().hostOrigin !== context.origin) store.set({ hostOrigin: context.origin });
    switch (request.type) {
      case 'init': {
        const server = await client.getConfig();
        config = effectiveConfig(
          server,
          { loginMethods: request.loginMethods, appearance: request.appearance },
          context.raw,
        );
        store.set({ config });
        const user = await client.ready();
        return { user, config } satisfies HostResponseDataMap['init'];
      }
      case 'getUser':
        return { user: await currentUser() } satisfies HostResponseDataMap['getUser'];
      case 'logout': {
        await client.auth.logout();
        if (active && !active.settled && active.kind !== 'login') {
          active.reject(new EmbedFailure('not_authenticated', 'The user logged out.'));
        }
        return { ok: true } satisfies HostResponseDataMap['logout'];
      }
      case 'createWallet':
        return client.wallets.create(request.chainFamily);
      case 'login':
        return login(request);
      case 'signMessage': {
        const wallet = await requireWallet(request.walletId);
        const call = () => client.wallets.signMessage(wallet.id, request.input);
        if (request.confirm === false) return call();
        await ensureConfig();
        return confirm(
          {
            name: 'signMessage',
            origin: context.origin,
            wallet,
            input: request.input,
            status: 'idle',
            error: null,
          },
          call,
        );
      }
      case 'signTypedData': {
        const wallet = await requireWallet(request.walletId);
        const call = () => client.wallets.signTypedData(wallet.id, request.input);
        if (request.confirm === false) return call();
        await ensureConfig();
        return confirm(
          {
            name: 'signTypedData',
            origin: context.origin,
            wallet,
            input: request.input,
            status: 'idle',
            error: null,
          },
          call,
        );
      }
      case 'signTransaction':
      case 'sendTransaction': {
        const wallet = await requireWallet(request.walletId);
        const call =
          request.type === 'signTransaction'
            ? () => client.wallets.signTransaction(wallet.id, request.input)
            : () => client.wallets.sendTransaction(wallet.id, request.input);
        if (request.confirm === false) return call();
        await ensureConfig();
        return confirm<unknown>(
          {
            name: 'transaction',
            kind: request.type === 'signTransaction' ? 'sign' : 'send',
            origin: context.origin,
            wallet,
            input: request.input,
            status: 'idle',
            error: null,
          },
          call,
        );
      }
      case 'createSession': {
        const { input } = request;
        const wallet = await requireWallet(input.walletId);
        if (input.policy.chain !== wallet.chainFamily) {
          throw new EmbedFailure(
            'unsupported',
            `A ${input.policy.chain} policy cannot apply to a ${wallet.chainFamily} wallet.`,
          );
        }
        await ensureConfig();
        return confirm(
          {
            name: 'session',
            origin: context.origin,
            wallet,
            policy: input.policy,
            expiresAt: now() + durationToSeconds(input.policy.expiresIn) * 1000,
            status: 'idle',
            error: null,
          },
          () => client.sessions.create(input),
        );
      }
      /* No UI for these: a session exists so the app can sign without asking again. */
      case 'listSessions':
        return {
          sessions: await client.sessions.list(),
        } satisfies HostResponseDataMap['listSessions'];
      case 'revokeSession':
        await client.sessions.revoke(request.sessionId);
        return { ok: true } satisfies HostResponseDataMap['revokeSession'];
      case 'signWithSession':
        return client.sessions.sign(request.sessionId, request.request);
      case 'exportWallet': {
        const wallet = await requireWallet(request.walletId);
        await ensureConfig();
        return exportWallet(wallet);
      }
      case 'registerPasskey': {
        await client.ready();
        if (!client.auth.isAuthenticated()) {
          throw new EmbedFailure('not_authenticated', 'Log in before adding a passkey.');
        }
        await ensureConfig();
        return registerPasskey();
      }
      case 'close': {
        const task = active;
        if (task && !task.settled && !task.finishWithSuccess()) task.reject(userRejected());
        closeDialog();
        return { ok: true } satisfies HostResponseDataMap['close'];
      }
    }
  }

  /* Screen actions */

  const actions: ScreenActions = {
    dismiss() {
      const task = active;
      if (!task) {
        closeDialog();
        return;
      }
      if (task.settled || task.locked) return;
      task.onDismiss();
    },

    back() {
      if (!activeLogin()) return;
      const screen = store.get().screen;
      if (isScreen(screen, 'walletConfirm')) {
        navigate({ name: 'wallets', status: 'ready', options: walletOptions }, -1);
      } else if (screen && screen.name !== 'login') {
        navigate({ name: 'login' }, -1);
      }
    },

    submitEmail(email) {
      if (!activeLogin()) return;
      const trimmed = email.trim();
      if (trimmed) startEmail(trimmed);
    },

    verifyCode(code) {
      const state = store.get();
      if (!activeLogin() || !isScreen(state.screen, 'emailCode')) return;
      if (state.screen.status === 'verifying') return;
      const key = state.nav.key;
      const email = state.screen.email;
      patch(key, 'emailCode', (screen) => ({ ...screen, status: 'verifying', error: null }));
      client.auth.verifyEmailCode(email, code).then(
        (response) => {
          loginSucceeded(response.user);
        },
        (error: unknown) => {
          const { code: errorCode, message } = toEmbedError(error);
          patch(key, 'emailCode', (screen) => ({
            ...screen,
            status: 'idle',
            error: INVALID_CODE_ERRORS.has(errorCode) ? INVALID_CODE : message,
            resetKey: screen.resetKey + 1,
          }));
        },
      );
    },

    resendCode() {
      const state = store.get();
      if (!activeLogin() || !isScreen(state.screen, 'emailCode')) return;
      if (state.screen.resendAt > now()) return;
      const key = state.nav.key;
      const email = state.screen.email;
      patch(key, 'emailCode', (screen) => ({ ...screen, error: null, resendAt: now() + resendMs }));
      sendCode(key, email);
    },

    loginWithOAuth(provider) {
      if (activeLogin()) startOAuth(provider);
    },

    loginWithPasskey() {
      if (activeLogin()) startPasskeyLogin();
    },

    openWallets() {
      if (activeLogin()) discoverWallets();
    },

    chooseWallet(id) {
      const state = store.get();
      if (!activeLogin() || !isScreen(state.screen, 'wallets')) return;
      const wallet = state.screen.options.find((option) => option.id === id);
      if (!wallet) return;
      const key = navigate({ name: 'walletConfirm', wallet, status: 'waiting', message: null });
      signInWithWallet(key, id);
    },

    retry() {
      const state = store.get();
      const screen = state.screen;
      if (isScreen(screen, 'passkey') && screen.mode === 'register') {
        active?.approve?.();
        return;
      }
      if (!activeLogin()) return;
      if (isScreen(screen, 'passkey')) startPasskeyLogin();
      else if (isScreen(screen, 'oauth')) startOAuth(screen.provider);
      else if (isScreen(screen, 'wallets')) discoverWallets();
      else if (isScreen(screen, 'walletConfirm')) signInWithWallet(state.nav.key, screen.wallet.id);
    },

    approve() {
      const task = active;
      if (task?.kind === 'confirm') task.approve?.();
    },

    cancel() {
      const task = active;
      const screen = store.get().screen;
      if (!task || task.settled || task.locked) return;
      if (isConfirmScreen(screen) && screen.status === 'error' && screen.error) {
        const { error } = screen;
        const reason =
          'reason' in error && typeof error.reason === 'string' ? error.reason : undefined;
        task.reject(new EmbedFailure(error.code, error.message, reason));
        return;
      }
      task.onDismiss();
    },

    reveal() {
      const task = active;
      if (task?.kind === 'export') task.approve?.();
    },

    finish() {
      const task = active;
      if (!task) {
        closeDialog();
        return;
      }
      if (!task.settled && !task.locked) task.onDismiss();
    },
  };

  return { handle, actions };
}
