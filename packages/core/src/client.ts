import {
  AuthResponse,
  AuthTokens,
  DEVICE_ID_HEADER,
  DeviceId,
  ExportWalletOutput,
  LogoutOutput,
  MeResponse,
  PublicAppConfig,
  PublicAppId,
  RefreshToken,
  SendTransactionOutput,
  SessionList,
  SessionSigner,
  SessionSignOutput,
  SignMessageOutput,
  SignTransactionOutput,
  Wallet,
  WalletList,
  WalletNonceOutput,
  type ChainFamily,
  type CreateSessionInput,
  type EndUser,
  type EvmTransactionRequest,
  type SendTransactionInput,
  type SessionSignRequestInput,
  type SignMessageInput,
  type SignTypedDataInput,
  type SolanaCluster,
  type TransactionRequest,
} from '@pocketkey/types';
import { z } from 'zod';
import { errorFromResponse, isPocketkeyError, PocketkeyError } from './errors.js';
import { OAUTH_POPUP_TIMEOUT_MS, openPopup, popupHost, waitForOAuthCode } from './oauth.js';
import {
  AuthenticationOptions,
  isPasskeySupported,
  RegisteredPasskey,
  RegistrationOptions,
  runAuthentication,
  runRegistration,
} from './passkey.js';
import { localStorageStorage, memoryStorage, type TokenStorage } from './storage.js';

export const DEFAULT_BASE_URL = 'https://api.pocketkey.dev';

export const APP_ID_HEADER = 'X-Pocketkey-App-Id';
export const AUTH_COOKIES_HEADER = 'X-Pocketkey-Auth-Cookies';

export interface PocketkeyOptions {
  /** Public app id (`pk_app_...`). Throws `PocketkeyError('bad_request')` when malformed. */
  appId: string;
  /** Defaults to `DEFAULT_BASE_URL`. A trailing slash is tolerated. */
  baseUrl?: string;
  /** Defaults to `localStorageStorage()` in browsers, `memoryStorage()` elsewhere. */
  storage?: TokenStorage;
  /** Defaults to the global `fetch`, called unbound-safe (Workers "Illegal invocation"). */
  fetch?: typeof fetch;
  /** Refresh proactively when the access token expires within this window. Default 60. */
  refreshLeewaySeconds?: number;
}

export interface SessionState {
  user: EndUser;
  accessTokenExpiresAt: string;
}

export type AuthListener = (user: EndUser | null) => void;

export type OAuthProvider = 'google' | 'apple';

export interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'DELETE';
  /** JSON encoded when present. */
  body?: unknown;
  /** Sends the bearer access token, refreshing it when needed. Default false. */
  auth?: boolean;
  /** Validates the 2xx body. A mismatch throws `invalid_response`. */
  schema: z.ZodType<T>;
  headers?: Record<string, string>;
}

export interface PocketkeyClient {
  readonly appId: string;
  readonly baseUrl: string;
  /**
   * Restores a stored session (refreshing if needed). Idempotent, safe to call
   * many times; every method below awaits it internally. Resolves with the
   * user or null, never rejects.
   */
  ready(): Promise<EndUser | null>;
  /** Public app configuration, cached per client. */
  getConfig(): Promise<PublicAppConfig>;
  auth: {
    /** True while the client holds a session (tokens), even if the user is not loaded yet. */
    isAuthenticated(): boolean;
    /** Cached user, sync. */
    getUser(): EndUser | null;
    /**
     * `GET /v1/me`. Resolves null when logged out or when the session turns
     * out to be gone (the listeners then receive null). Network and server
     * errors reject.
     */
    refreshUser(): Promise<EndUser | null>;
    /** Fires on login, logout, user refresh and session loss. Returns an unsubscribe function. */
    onChange(listener: AuthListener): () => void;
    sendEmailCode(email: string): Promise<void>;
    verifyEmailCode(email: string, code: string): Promise<AuthResponse>;
    /** Sends the code and remembers the email for `verifyOtp`. */
    loginWithEmail(email: string): Promise<void>;
    /** Verifies the code for the email given to `loginWithEmail`. Throws `bad_request` if none. */
    verifyOtp(code: string): Promise<AuthResponse>;
    getWalletNonce(chainFamily: ChainFamily): Promise<WalletNonceOutput>;
    loginWithSiwe(input: { message: string; signature: `0x${string}` }): Promise<AuthResponse>;
    loginWithSiws(input: {
      message: string;
      signature: string;
      publicKey: string;
    }): Promise<AuthResponse>;
    passkey: {
      /** Never throws, whatever the runtime. */
      isSupported(): boolean;
      /** Enrolls a passkey on the signed-in user (needs an email or passkey login in this storage). */
      register(options?: { name?: string }): Promise<EndUser>;
      login(): Promise<AuthResponse>;
    };
    oauth: {
      startUrl(provider: OAuthProvider): string;
      exchange(code: string): Promise<AuthResponse>;
      /**
       * Opens the popup synchronously (call it from a click handler), waits for
       * the code, exchanges it. Rejects `popup_blocked`, `user_rejected` (popup
       * closed or timed out), or the provider error.
       */
      loginWithPopup(
        provider: OAuthProvider,
        options?: { apiOrigin?: string; timeoutMs?: number },
      ): Promise<AuthResponse>;
    };
    /** Best effort server call, always clears local state and emits null. */
    logout(): Promise<void>;
  };
  wallets: {
    list(): Promise<Wallet[]>;
    create(chainFamily: ChainFamily): Promise<Wallet>;
    /** From the cached user. */
    get(chainFamily: ChainFamily): Wallet | null;
    signMessage(walletId: string, input: SignMessageInput): Promise<SignMessageOutput>;
    signTypedData(walletId: string, input: SignTypedDataInput): Promise<SignMessageOutput>;
    signTransaction(walletId: string, input: TransactionRequest): Promise<SignTransactionOutput>;
    sendTransaction(walletId: string, input: SendTransactionInput): Promise<SendTransactionOutput>;
    exportWallet(walletId: string, targetPublicKey: string): Promise<ExportWalletOutput>;
    /**
     * Helpers on the user's EVM wallet. Throw `not_authenticated` when logged
     * out and `not_found` (details `{ reason: 'wallet_not_found' }`) without one.
     */
    evm: {
      signMessage(message: string | { raw: `0x${string}` }): Promise<SignMessageOutput>;
      signTypedData(input: Omit<SignTypedDataInput, 'chain'>): Promise<SignMessageOutput>;
      signTransaction(input: Omit<EvmTransactionRequest, 'chain'>): Promise<SignTransactionOutput>;
      sendTransaction(
        input: Omit<EvmTransactionRequest, 'chain'> & { sponsored?: boolean },
      ): Promise<SendTransactionOutput>;
    };
    /** Same rules as `evm`, on the user's Solana wallet. */
    solana: {
      signMessage(base64Message: string): Promise<SignMessageOutput>;
      signTransaction(input: {
        cluster: SolanaCluster;
        transaction: string;
      }): Promise<SignTransactionOutput>;
      sendTransaction(input: {
        cluster: SolanaCluster;
        transaction: string;
        sponsored?: boolean;
      }): Promise<SendTransactionOutput>;
    };
  };
  /**
   * Session signers (section 7.4): the user allows the app to sign within a
   * policy without a confirmation each time. Policy refusals reject
   * `policy_violation` (HTTP 403) with `details.reason`, see `policyViolationReason`.
   */
  sessions: {
    /** `POST /v1/sessions`. Creates the key provider policy for the wallet. */
    create(input: CreateSessionInput): Promise<SessionSigner>;
    /** `GET /v1/sessions`, newest first, including revoked and expired sessions. */
    list(): Promise<SessionSigner[]>;
    /** `DELETE /v1/sessions/:id`. Idempotent. */
    revoke(sessionId: string): Promise<void>;
    /** `POST /v1/sessions/:id/sign`. No confirmation: the policy is enforced server side. */
    sign(sessionId: string, request: SessionSignRequestInput): Promise<SessionSignOutput>;
    /** Active = not revoked and not expired at call time. */
    isActive(session: SessionSigner, now?: Date): boolean;
  };
  /** Low level: typed request with app header, auth, bridge cookies, refresh-and-retry, Zod output validation. */
  request<T>(path: string, init: RequestOptions<T>): Promise<T>;
}

interface Session {
  accessToken: string;
  /** Epoch ms. 0 when unknown, which forces a refresh. */
  accessTokenExpiresAt: number;
  refreshToken: string;
}

const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
/** Visible ASCII only: a stored value must never be able to inject a header. */
const COOKIE_HEADER_VALUE = /^[\x20-\x7e]{0,8192}$/;
const IsoDate = z.iso.datetime();
const OtpSent = z.object({ success: z.boolean() });
const RevokeOutput = z.object({ ok: z.literal(true) });

/** Active = not revoked and not expired at `now` (default: call time). */
export function isSessionActive(session: SessionSigner, now: Date = new Date()): boolean {
  if (session.revokedAt !== null) return false;
  const expiresAt = Date.parse(session.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > now.getTime();
}

function notAuthenticated(message = 'Sign in first'): PocketkeyError {
  return new PocketkeyError('not_authenticated', message);
}

function randomDeviceId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function isBrowser(): boolean {
  return typeof (globalThis as { document?: unknown }).document !== 'undefined';
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.replace(/\/+$/, '');
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('protocol');
  } catch {
    throw new PocketkeyError('bad_request', `Invalid baseUrl: ${raw}`);
  }
  return trimmed;
}

export function createPocketkey(options: PocketkeyOptions): PocketkeyClient {
  const parsedAppId = PublicAppId.safeParse(options.appId);
  if (!parsedAppId.success) {
    throw new PocketkeyError('bad_request', 'Invalid appId, expected "pk_app_..."', {
      details: parsedAppId.error.issues,
    });
  }
  const appId: string = parsedAppId.data;
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
  const storage = options.storage ?? (isBrowser() ? localStorageStorage() : memoryStorage());
  const customFetch = options.fetch;
  const doFetch = (url: string, init: RequestInit): Promise<Response> =>
    customFetch ? customFetch(url, init) : globalThis.fetch(url, init);
  const leewayMs = Math.max(0, options.refreshLeewaySeconds ?? 60) * 1000;

  const keys = {
    refresh: `pocketkey:${appId}:refresh`,
    access: `pocketkey:${appId}:access`,
    accessExp: `pocketkey:${appId}:accessExp`,
    authCookies: `pocketkey:${appId}:authCookies`,
    device: `pocketkey:${appId}:device`,
  };

  let session: Session | null = null;
  let user: EndUser | null = null;
  let authCookies = '';
  let pendingEmail: string | null = null;
  let readyPromise: Promise<void> | null = null;
  let refreshing: Promise<void> | null = null;
  let devicePromise: Promise<string> | null = null;
  let configPromise: Promise<PublicAppConfig> | null = null;
  /** False after a failed refresh token write: storage may then hold a stale, rotated token. */
  let storageInSync = true;
  const listeners = new Set<AuthListener>();
  /** Reads the live session after an await (defeats stale narrowing). */
  const currentSession = (): Session | null => session;

  /* Storage, always best effort: the in-memory state stays authoritative for this client. */

  async function read(key: string): Promise<string | null> {
    try {
      const value = await storage.get(key);
      return typeof value === 'string' ? value : null;
    } catch {
      return null;
    }
  }

  async function write(key: string, value: string): Promise<boolean> {
    try {
      await storage.set(key, value);
      return true;
    } catch {
      // Keep going with the in-memory copy.
      return false;
    }
  }

  async function erase(key: string): Promise<void> {
    try {
      await storage.remove(key);
    } catch {
      // Keep going with the in-memory copy.
    }
  }

  async function loadStoredSession(): Promise<Session | null> {
    const refreshToken = RefreshToken.safeParse(await read(keys.refresh));
    if (!refreshToken.success) return null;
    const access = await read(keys.access);
    const exp = IsoDate.safeParse(await read(keys.accessExp));
    const valid = access !== null && JWT.test(access) && exp.success;
    return {
      refreshToken: refreshToken.data,
      accessToken: valid ? access : '',
      accessTokenExpiresAt: valid ? Date.parse(exp.data) : 0,
    };
  }

  async function storeTokens(tokens: AuthTokens): Promise<void> {
    session = {
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: Date.parse(tokens.accessTokenExpiresAt),
      refreshToken: tokens.refreshToken,
    };
    storageInSync = await write(keys.refresh, tokens.refreshToken);
    await write(keys.access, tokens.accessToken);
    await write(keys.accessExp, tokens.accessTokenExpiresAt);
  }

  async function setAuthCookies(value: string): Promise<void> {
    authCookies = COOKIE_HEADER_VALUE.test(value) ? value : '';
    if (authCookies) await write(keys.authCookies, authCookies);
    else await erase(keys.authCookies);
  }

  function emit(next: EndUser | null): void {
    for (const listener of [...listeners]) {
      try {
        listener(next);
      } catch (e) {
        console.error('[pocketkey] auth listener threw', e);
      }
    }
  }

  function setUser(next: EndUser | null): void {
    user = next;
    emit(next);
  }

  async function clearSession(): Promise<void> {
    const hadState = session !== null || user !== null;
    session = null;
    user = null;
    await erase(keys.refresh);
    await erase(keys.access);
    await erase(keys.accessExp);
    if (hadState) emit(null);
  }

  function deviceId(): Promise<string> {
    devicePromise ??= (async () => {
      const stored = DeviceId.safeParse(await read(keys.device));
      if (stored.success) return stored.data;
      const fresh = randomDeviceId();
      await write(keys.device, fresh);
      return fresh;
    })();
    return devicePromise;
  }

  /* HTTP */

  function isFresh(current: Session): boolean {
    return current.accessToken !== '' && current.accessTokenExpiresAt - Date.now() > leewayMs;
  }

  async function accessToken(): Promise<string> {
    if (!session) throw notAuthenticated();
    if (!isFresh(session)) await refreshSession();
    const current = currentSession();
    if (!current) throw notAuthenticated();
    return current.accessToken;
  }

  async function send<T>(path: string, init: RequestOptions<T>, retried = false): Promise<T> {
    const headers: Record<string, string> = { ...init.headers, [APP_ID_HEADER]: appId };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    if (path.startsWith('/v1/auth/') && authCookies) headers[AUTH_COOKIES_HEADER] = authCookies;
    let token: string | undefined;
    if (init.auth) {
      token = await accessToken();
      headers.Authorization = `Bearer ${token}`;
    }

    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path.startsWith('/') ? path : `/${path}`}`, {
        method: init.method ?? 'GET',
        headers,
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      });
    } catch (e) {
      throw new PocketkeyError('network_error', 'Could not reach the Pocketkey API', { cause: e });
    }

    const bridged = response.headers.get(AUTH_COOKIES_HEADER);
    if (bridged !== null) await setAuthCookies(bridged);

    if (!response.ok) {
      const error = await errorFromResponse(response);
      if (
        init.auth &&
        !retried &&
        response.status === 401 &&
        (error.code === 'session_expired' || error.code === 'unauthorized')
      ) {
        // A concurrent caller may already have refreshed: only refresh for the token we used.
        if (session?.accessToken === token) await refreshSession(true);
        return send(path, init, true);
      }
      throw error;
    }

    const requestId = response.headers.get('X-Request-Id') ?? undefined;
    let data: unknown;
    const text = await response.text();
    if (text !== '') {
      try {
        data = JSON.parse(text);
      } catch (e) {
        throw new PocketkeyError('invalid_response', 'The API answered with invalid JSON', {
          status: response.status,
          requestId,
          cause: e,
        });
      }
    }
    const parsed = init.schema.safeParse(data);
    if (!parsed.success) {
      throw new PocketkeyError('invalid_response', `Unexpected response from ${path}`, {
        status: response.status,
        requestId,
        details: parsed.error.issues,
      });
    }
    return parsed.data;
  }

  /** Single flight: concurrent callers share one refresh. */
  function refreshSession(force = false): Promise<void> {
    refreshing ??= doRefresh(force).finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  async function doRefresh(force: boolean): Promise<void> {
    const current = session;
    if (!current) throw notAuthenticated();

    // Another client on the same storage (a second tab) may have rotated the token already.
    let refreshToken = current.refreshToken;
    const stored = storageInSync ? await loadStoredSession() : null;
    if (stored && stored.refreshToken !== current.refreshToken) {
      session = stored;
      refreshToken = stored.refreshToken;
      if (isFresh(stored) && (!force || stored.accessToken !== current.accessToken)) return;
    }

    let tokens: AuthTokens;
    try {
      tokens = await send('/v1/auth/refresh', {
        method: 'POST',
        body: { refreshToken },
        schema: AuthTokens,
      });
    } catch (e) {
      if (isPocketkeyError(e) && e.status === 401) {
        await clearSession();
        throw new PocketkeyError('not_authenticated', 'Session expired, sign in again', {
          status: 401,
          requestId: e.requestId,
          details: { code: e.code },
          cause: e,
        });
      }
      throw e;
    }
    await storeTokens(tokens);
  }

  async function loadUser(): Promise<EndUser | null> {
    if (!session) return null;
    try {
      const me = await send('/v1/me', { auth: true, schema: MeResponse });
      setUser(me.user);
      return me.user;
    } catch (e) {
      if (isPocketkeyError(e) && e.code === 'not_authenticated') return null;
      throw e;
    }
  }

  async function restore(): Promise<void> {
    const cookies = await read(keys.authCookies);
    authCookies = cookies !== null && COOKIE_HEADER_VALUE.test(cookies) ? cookies : '';
    const stored = await loadStoredSession();
    if (!stored) return;
    session = stored;
    try {
      if (!isFresh(stored)) await refreshSession();
      if (!user) await loadUser();
    } catch {
      // Offline or server trouble: keep the stored session, the next call retries.
    }
  }

  async function ready(): Promise<EndUser | null> {
    readyPromise ??= restore().catch(() => undefined);
    await readyPromise;
    return user;
  }

  async function completeLogin(response: AuthResponse): Promise<AuthResponse> {
    await storeTokens(response);
    pendingEmail = null;
    setUser(response.user);
    return response;
  }

  /* Auth */

  async function sendEmailCode(email: string): Promise<void> {
    await ready();
    await send('/v1/auth/email-otp/send-verification-otp', {
      method: 'POST',
      body: { email, type: 'sign-in' },
      headers: { [DEVICE_ID_HEADER]: await deviceId() },
      schema: OtpSent,
    });
  }

  async function verifyEmailCode(email: string, code: string): Promise<AuthResponse> {
    await ready();
    const response = await send('/v1/auth/sign-in/email-otp', {
      method: 'POST',
      body: { email, otp: code },
      headers: { [DEVICE_ID_HEADER]: await deviceId() },
      schema: AuthResponse,
    });
    return completeLogin(response);
  }

  async function exchangeOAuthCode(code: string): Promise<AuthResponse> {
    await ready();
    const response = await send('/v1/auth/oauth/exchange', {
      method: 'POST',
      body: { code },
      schema: AuthResponse,
    });
    return completeLogin(response);
  }

  function oauthStartUrl(provider: OAuthProvider): string {
    return `${baseUrl}/v1/auth/oauth/${appId}/${provider}/start`;
  }

  async function authed<T>(path: string, init: Omit<RequestOptions<T>, 'auth'>): Promise<T> {
    await ready();
    return send(path, { ...init, auth: true });
  }

  const walletPath = (walletId: string, action: string) =>
    `/v1/wallets/${encodeURIComponent(walletId)}/${action}`;

  async function walletOf(family: ChainFamily): Promise<Wallet> {
    await ready();
    if (!session) throw notAuthenticated();
    let wallet = user?.wallets.find((w) => w.chainFamily === family);
    if (!wallet && !user)
      wallet = (await loadUser())?.wallets.find((w) => w.chainFamily === family);
    if (!currentSession()) throw notAuthenticated();
    if (!wallet) {
      throw new PocketkeyError('not_found', `The user has no ${family} wallet`, {
        details: { reason: 'wallet_not_found', chainFamily: family },
      });
    }
    return wallet;
  }

  const wallets: PocketkeyClient['wallets'] = {
    async list() {
      const out = await authed('/v1/wallets', { schema: WalletList });
      return out.wallets;
    },
    async create(chainFamily) {
      const wallet = await authed('/v1/wallets', {
        method: 'POST',
        body: { chainFamily },
        schema: Wallet,
      });
      if (user) {
        setUser({ ...user, wallets: [...user.wallets.filter((w) => w.id !== wallet.id), wallet] });
      }
      return wallet;
    },
    get(chainFamily) {
      return user?.wallets.find((w) => w.chainFamily === chainFamily) ?? null;
    },
    signMessage(walletId, input) {
      return authed(walletPath(walletId, 'sign-message'), {
        method: 'POST',
        body: input,
        schema: SignMessageOutput,
      });
    },
    signTypedData(walletId, input) {
      return authed(walletPath(walletId, 'sign-typed-data'), {
        method: 'POST',
        body: input,
        schema: SignMessageOutput,
      });
    },
    signTransaction(walletId, input) {
      return authed(walletPath(walletId, 'sign-transaction'), {
        method: 'POST',
        body: input,
        schema: SignTransactionOutput,
      });
    },
    sendTransaction(walletId, input) {
      return authed(walletPath(walletId, 'send-transaction'), {
        method: 'POST',
        body: input,
        schema: SendTransactionOutput,
      });
    },
    exportWallet(walletId, targetPublicKey) {
      return authed(walletPath(walletId, 'export'), {
        method: 'POST',
        body: { targetPublicKey },
        schema: ExportWalletOutput,
      });
    },
    evm: {
      async signMessage(message) {
        const wallet = await walletOf('evm');
        return wallets.signMessage(wallet.id, { chain: 'evm', message });
      },
      async signTypedData(input) {
        const wallet = await walletOf('evm');
        return wallets.signTypedData(wallet.id, { ...input, chain: 'evm' });
      },
      async signTransaction(input) {
        const wallet = await walletOf('evm');
        return wallets.signTransaction(wallet.id, { ...input, chain: 'evm' });
      },
      async sendTransaction(input) {
        const wallet = await walletOf('evm');
        return wallets.sendTransaction(wallet.id, {
          ...input,
          chain: 'evm',
          sponsored: input.sponsored ?? false,
        });
      },
    },
    solana: {
      async signMessage(base64Message) {
        const wallet = await walletOf('solana');
        return wallets.signMessage(wallet.id, { chain: 'solana', message: base64Message });
      },
      async signTransaction(input) {
        const wallet = await walletOf('solana');
        return wallets.signTransaction(wallet.id, {
          chain: 'solana',
          cluster: input.cluster,
          transaction: input.transaction,
        });
      },
      async sendTransaction(input) {
        const wallet = await walletOf('solana');
        return wallets.sendTransaction(wallet.id, {
          chain: 'solana',
          cluster: input.cluster,
          transaction: input.transaction,
          sponsored: input.sponsored ?? false,
        });
      },
    },
  };

  const sessionPath = (sessionId: string, action = '') =>
    `/v1/sessions/${encodeURIComponent(sessionId)}${action ? `/${action}` : ''}`;

  const sessions: PocketkeyClient['sessions'] = {
    create(input) {
      return authed('/v1/sessions', { method: 'POST', body: input, schema: SessionSigner });
    },
    async list() {
      const out = await authed('/v1/sessions', { schema: SessionList });
      return out.sessions;
    },
    async revoke(sessionId) {
      await authed(sessionPath(sessionId), { method: 'DELETE', schema: RevokeOutput });
    },
    sign(sessionId, request) {
      return authed(sessionPath(sessionId, 'sign'), {
        method: 'POST',
        body: request,
        schema: SessionSignOutput,
      });
    },
    isActive: isSessionActive,
  };

  const client: PocketkeyClient = {
    appId,
    baseUrl,
    ready,

    getConfig() {
      configPromise ??= (async () => {
        await ready();
        return send(`/v1/apps/${appId}/config`, { schema: PublicAppConfig });
      })().catch((e: unknown) => {
        configPromise = null;
        throw e;
      });
      return configPromise;
    },

    auth: {
      isAuthenticated: () => session !== null,
      getUser: () => user,
      async refreshUser() {
        await ready();
        return loadUser();
      },
      onChange(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      sendEmailCode,
      verifyEmailCode,
      async loginWithEmail(email) {
        await sendEmailCode(email);
        pendingEmail = email;
      },
      async verifyOtp(code) {
        if (pendingEmail === null) {
          throw new PocketkeyError(
            'bad_request',
            'Call loginWithEmail(email) before verifyOtp(code)',
          );
        }
        return verifyEmailCode(pendingEmail, code);
      },
      async getWalletNonce(chainFamily) {
        await ready();
        return send('/v1/auth/wallet/nonce', {
          method: 'POST',
          body: { chainFamily },
          schema: WalletNonceOutput,
        });
      },
      async loginWithSiwe(input) {
        await ready();
        const response = await send('/v1/auth/wallet/verify', {
          method: 'POST',
          body: { chainFamily: 'evm', message: input.message, signature: input.signature },
          schema: AuthResponse,
        });
        return completeLogin(response);
      },
      async loginWithSiws(input) {
        await ready();
        const response = await send('/v1/auth/wallet/verify', {
          method: 'POST',
          body: {
            chainFamily: 'solana',
            message: input.message,
            signature: input.signature,
            publicKey: input.publicKey,
          },
          schema: AuthResponse,
        });
        return completeLogin(response);
      },

      passkey: {
        isSupported: isPasskeySupported,
        async register(registerOptions = {}) {
          await ready();
          if (!session) throw notAuthenticated();
          if (!isPasskeySupported()) {
            throw new PocketkeyError('unsupported', 'Passkeys are not supported in this browser');
          }
          const optionsJSON = await send('/v1/auth/passkey/generate-register-options', {
            schema: RegistrationOptions,
          });
          const response = await runRegistration(optionsJSON);
          await send('/v1/auth/passkey/verify-registration', {
            method: 'POST',
            body:
              registerOptions.name === undefined
                ? { response }
                : { response, name: registerOptions.name },
            schema: RegisteredPasskey,
          });
          const refreshed = await loadUser();
          if (!refreshed) throw notAuthenticated();
          return refreshed;
        },
        async login() {
          await ready();
          if (!isPasskeySupported()) {
            throw new PocketkeyError('unsupported', 'Passkeys are not supported in this browser');
          }
          const optionsJSON = await send('/v1/auth/passkey/generate-authenticate-options', {
            schema: AuthenticationOptions,
          });
          const response = await runAuthentication(optionsJSON);
          const login = await send('/v1/auth/passkey/verify-authentication', {
            method: 'POST',
            body: { response },
            schema: AuthResponse,
          });
          return completeLogin(login);
        },
      },

      oauth: {
        startUrl: oauthStartUrl,
        exchange: exchangeOAuthCode,
        loginWithPopup(provider, popupOptions = {}) {
          // No await before window.open: browsers only allow popups inside the user gesture.
          const host = popupHost();
          if (!host) {
            return Promise.reject(
              new PocketkeyError('unsupported', 'OAuth popups need a browser window'),
            );
          }
          let expectedOrigin: string;
          try {
            expectedOrigin = new URL(popupOptions.apiOrigin ?? baseUrl).origin;
          } catch {
            return Promise.reject(new PocketkeyError('bad_request', 'Invalid apiOrigin'));
          }
          const popup = openPopup(host, oauthStartUrl(provider));
          if (!popup) {
            return Promise.reject(
              new PocketkeyError('popup_blocked', 'The browser blocked the sign-in popup'),
            );
          }
          return waitForOAuthCode(host, popup, {
            expectedOrigin,
            timeoutMs: popupOptions.timeoutMs ?? OAUTH_POPUP_TIMEOUT_MS,
          }).then(exchangeOAuthCode);
        },
      },

      async logout() {
        await ready();
        const hadState = session !== null || user !== null;
        if (session) {
          try {
            await send('/v1/auth/logout', { method: 'POST', auth: true, schema: LogoutOutput });
          } catch {
            // Best effort: local state is cleared regardless.
          }
        }
        pendingEmail = null;
        // clearSession emits when state remains; a session lost during the call already emitted.
        await clearSession();
        await setAuthCookies('');
        if (!hadState) emit(null);
      },
    },

    wallets,
    sessions,

    async request(path, init) {
      await ready();
      return send(path, init);
    },
  };

  return client;
}
