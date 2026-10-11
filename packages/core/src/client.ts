import {
  AuthResponse,
  AuthTokens,
  durationToSeconds,
  EmailOtpStartOutput,
  EmailOtpVerifyOutput,
  EndUser,
  ExportWalletOutput,
  KeySession,
  LogoutOutput,
  MeResponse,
  PreparedOperation,
  PublicAppConfig,
  PublicAppId,
  RefreshToken,
  SendTransactionOutput,
  SessionList,
  SessionSigner,
  SessionSignOutput,
  SignerSetupOutput,
  SignMessageOutput,
  SignTransactionOutput,
  Wallet,
  WalletList,
  type ChainFamily,
  type CreateSessionInput,
  type EvmTransactionRequest,
  type SendTransactionInput,
  type SessionSignRequestInput,
  type SignMessageInput,
  type SignTypedDataInput,
  type SolanaCluster,
  type TransactionRequest,
} from '@pockey/types';
import { z } from 'zod';
import { errorFromResponse, isPockeyError, PockeyError } from './errors.js';
import type { KeyClient } from './keys.js';
import { OAUTH_POPUP_TIMEOUT_MS, openPopup, popupHost, waitForOAuthCode } from './oauth.js';
import { assertPasskey, createPasskey, isPasskeySupported } from './passkey.js';
import { localStorageStorage, memoryStorage, type TokenStorage } from './storage.js';

export const DEFAULT_BASE_URL = 'https://api.pockey.xyz';

export const APP_ID_HEADER = 'X-Pockey-App-Id';

export interface PockeyOptions {
  /** Public app id (`pk_app_...`). Throws `PockeyError('bad_request')` when malformed. */
  appId: string;
  /** Defaults to `DEFAULT_BASE_URL`. A trailing slash is tolerated. */
  baseUrl?: string;
  /** Defaults to `localStorageStorage()` in browsers, `memoryStorage()` elsewhere. */
  storage?: TokenStorage;
  /** Defaults to the global `fetch`, called unbound-safe (Workers "Illegal invocation"). */
  fetch?: typeof fetch;
  /** Refresh proactively when the access token expires within this window. Default 60. */
  refreshLeewaySeconds?: number;
  /**
   * The user's key session (the embed iframe provides it). Without it, logins and
   * signatures throw `unsupported`: Pockey cannot sign on anyone's behalf.
   */
  keys?: KeyClient;
  /** WebAuthn relying party id. Defaults to the current host (the embed iframe). */
  passkeyRpId?: string;
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

/** An external wallet signing the login request itself (one prompt). */
export type WalletLogin =
  | {
      chainFamily: 'evm';
      address: string;
      personalSign: (message: string) => Promise<`0x${string}`>;
    }
  | {
      chainFamily: 'solana';
      address: string;
      signMessage: (message: Uint8Array) => Promise<Uint8Array>;
    };

export interface PockeyClient {
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
    /** The key provider emails a code. */
    sendEmailCode(email: string): Promise<void>;
    /** Encrypts the code to the key provider, then signs up or logs in. */
    verifyEmailCode(email: string, code: string): Promise<AuthResponse>;
    /** Sends the code and remembers the email for `verifyOtp`. */
    loginWithEmail(email: string): Promise<void>;
    /** Verifies the code for the email given to `loginWithEmail`. Throws `bad_request` if none. */
    verifyOtp(code: string): Promise<AuthResponse>;
    /** External wallet: it signs the login request (sign-up on first use). */
    loginWithWallet(wallet: WalletLogin): Promise<AuthResponse>;
    passkey: {
      /** Never throws, whatever the runtime. */
      isSupported(): boolean;
      /** Enrolls a passkey on the signed-in user. */
      register(options?: { name?: string }): Promise<EndUser>;
      login(): Promise<AuthResponse>;
    };
    oauth: {
      startUrl(provider: OAuthProvider, sessionPublicKey: string): string;
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
    /** Decrypted in this document with a one-time key. The API only relays ciphertext. */
    exportWallet(walletId: string): Promise<{ privateKey: string }>;
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
    /** Creates the key provider policy (stamped here) and its mirror. */
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
  /** Low level: typed request with app header, auth, refresh-and-retry, Zod output validation. */
  request<T>(path: string, init: RequestOptions<T>): Promise<T>;
}

interface Session {
  accessToken: string;
  /** Epoch ms. 0 when unknown, which forces a refresh. */
  accessTokenExpiresAt: number;
  refreshToken: string;
}

interface PendingOtp {
  email: string;
  otpId: string;
  targetBundle: string;
}

const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const IsoDate = z.iso.datetime();
const RevokeOutput = z.object({ ok: z.literal(true) });
const WalletLookup = z.object({ organizationId: z.string().nullable() });

/** Active = not revoked and not expired at `now` (default: call time). */
export function isSessionActive(session: SessionSigner, now: Date = new Date()): boolean {
  if (session.revokedAt !== null) return false;
  const expiresAt = Date.parse(session.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > now.getTime();
}

function notAuthenticated(message = 'Sign in first'): PockeyError {
  return new PockeyError('not_authenticated', message);
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
    throw new PockeyError('bad_request', `Invalid baseUrl: ${raw}`);
  }
  return trimmed;
}

function randomToken(bytes: number): string {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = '';
  for (const byte of values) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Key session failures surface as SDK errors the UI can act on. */
function keyFailure(error: unknown): never {
  if (isPockeyError(error)) throw error;
  const reason = (error as { reason?: unknown }).reason;
  if (reason === 'no_session') {
    throw new PockeyError('not_authenticated', 'Sign in again to use your wallet', {
      details: { reason: 'key_session_missing' },
      cause: error,
    });
  }
  if (reason === 'unsupported') {
    throw new PockeyError(
      'unsupported',
      error instanceof Error ? error.message : 'Not available here',
      { details: { reason }, cause: error },
    );
  }
  if (reason === 'invalid_input') {
    throw new PockeyError(
      'bad_request',
      error instanceof Error ? error.message : 'Invalid request',
      { details: { reason }, cause: error },
    );
  }
  if (reason === 'prepared_mismatch') {
    throw new PockeyError(
      'bad_request',
      error instanceof Error ? error.message : 'The prepared transaction does not match',
      { details: { reason: 'prepared_mismatch' }, cause: error },
    );
  }
  throw new PockeyError(
    'internal',
    error instanceof Error ? error.message : 'Key session failure',
    { cause: error },
  );
}

export function createPockey(options: PockeyOptions): PockeyClient {
  const parsedAppId = PublicAppId.safeParse(options.appId);
  if (!parsedAppId.success) {
    throw new PockeyError('bad_request', 'Invalid appId, expected "pk_app_..."', {
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
    refresh: `pockey:${appId}:refresh`,
    access: `pockey:${appId}:access`,
    accessExp: `pockey:${appId}:accessExp`,
    keySession: `pockey:${appId}:keySession`,
  };

  let session: Session | null = null;
  let user: EndUser | null = null;
  let keySession: KeySession | null = null;
  let pendingEmail: string | null = null;
  let pendingOtp: PendingOtp | null = null;
  let readyPromise: Promise<void> | null = null;
  let refreshing: Promise<void> | null = null;
  let configPromise: Promise<PublicAppConfig> | null = null;
  /** False after a failed refresh token write: storage may then hold a stale, rotated token. */
  let storageInSync = true;
  const listeners = new Set<AuthListener>();
  /** Reads the live session after an await (defeats stale narrowing). */
  const currentSession = (): Session | null => session;

  function keyClient(): KeyClient {
    if (!options.keys) {
      throw new PockeyError(
        'unsupported',
        'This client has no key session: logins and signatures run in the Pockey iframe',
      );
    }
    return options.keys;
  }

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

  async function loadStoredKeySession(): Promise<KeySession | null> {
    const raw = await read(keys.keySession);
    if (raw === null) return null;
    try {
      const parsed = KeySession.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
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

  async function setKeySession(next: KeySession | null): Promise<void> {
    keySession = next;
    if (next) await write(keys.keySession, JSON.stringify(next));
    else await erase(keys.keySession);
  }

  function emit(next: EndUser | null): void {
    for (const listener of [...listeners]) {
      try {
        listener(next);
      } catch (e) {
        console.error('[pockey] auth listener threw', e);
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
    await setKeySession(null);
    await options.keys?.clear().catch(() => undefined);
    if (hadState) emit(null);
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
      throw new PockeyError('network_error', 'Could not reach the Pockey API', { cause: e });
    }

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
        throw new PockeyError('invalid_response', 'The API answered with invalid JSON', {
          status: response.status,
          requestId,
          cause: e,
        });
      }
    }
    const parsed = init.schema.safeParse(data);
    if (!parsed.success) {
      throw new PockeyError('invalid_response', `Unexpected response from ${path}`, {
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
      if (isPockeyError(e) && e.status === 401) {
        await clearSession();
        throw new PockeyError('not_authenticated', 'Session expired, sign in again', {
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
      if (me.keySession) await setKeySession(me.keySession);
      setUser(me.user);
      return me.user;
    } catch (e) {
      if (isPockeyError(e) && e.code === 'not_authenticated') return null;
      throw e;
    }
  }

  async function restore(): Promise<void> {
    const stored = await loadStoredSession();
    if (!stored) return;
    // Tokens without the session key that goes with them cannot sign: start over.
    if (options.keys && !(await options.keys.hasSession().catch(() => false))) {
      session = stored;
      await clearSession();
      return;
    }
    session = stored;
    keySession = await loadStoredKeySession();
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

  /** The key provider accepted the login: activate the key, store tokens and user. */
  async function completeLogin(response: AuthResponse): Promise<AuthResponse> {
    await keyClient().activate().catch(keyFailure);
    await storeTokens(response);
    await setKeySession(response.keySession);
    pendingEmail = null;
    pendingOtp = null;
    setUser(response.user);
    return response;
  }

  function requireKeySession(): KeySession {
    if (!session) throw notAuthenticated();
    if (!keySession) {
      throw new PockeyError('not_authenticated', 'Sign in again to use your wallet', {
        details: { reason: 'key_session_missing' },
      });
    }
    return keySession;
  }

  async function withKeys<T>(run: (client: KeyClient) => Promise<T>): Promise<T> {
    const client = keyClient();
    try {
      return await run(client);
    } catch (error) {
      return keyFailure(error);
    }
  }

  /* Auth */

  async function sendEmailCode(email: string): Promise<void> {
    await ready();
    keyClient();
    const normalized = email.trim().toLowerCase();
    const start = await send('/v1/auth/email/start', {
      method: 'POST',
      body: { email: normalized },
      schema: EmailOtpStartOutput,
    });
    pendingOtp = { email: normalized, ...start };
  }

  async function verifyEmailCode(email: string, code: string): Promise<AuthResponse> {
    await ready();
    const flow = pendingOtp;
    if (flow?.email !== email.trim().toLowerCase()) {
      throw new PockeyError('bad_request', 'Request a code for this email first');
    }
    const encryptedOtpBundle = await withKeys((client) =>
      client.encryptOtp({ code: code.trim(), targetBundle: flow.targetBundle }),
    );
    const verified = await send('/v1/auth/email/verify', {
      method: 'POST',
      body: { otpId: flow.otpId, encryptedOtpBundle },
      schema: EmailOtpVerifyOutput,
    });
    const body =
      verified.mode === 'signup'
        ? {
            mode: 'signup' as const,
            otpId: flow.otpId,
            ...(await withKeys((client) =>
              client.signupProof({
                verificationToken: verified.verificationToken,
                email: flow.email,
              }),
            )),
          }
        : {
            mode: 'login' as const,
            otpId: flow.otpId,
            ...(await withKeys((client) =>
              client.loginProof({ verificationToken: verified.verificationToken }),
            )),
          };
    const response = await send('/v1/auth/email/login', {
      method: 'POST',
      body,
      schema: AuthResponse,
    });
    return completeLogin(response);
  }

  async function loginWithWallet(wallet: WalletLogin): Promise<AuthResponse> {
    await ready();
    const lookup = await send('/v1/auth/wallet/lookup', {
      method: 'POST',
      body: { chainFamily: wallet.chainFamily, address: wallet.address },
      schema: WalletLookup,
    });
    const organizationId =
      lookup.organizationId ?? (await client.getConfig()).keyProvider.organizationId;
    const request = await withKeys((client) =>
      client.loginRequest({
        organizationId,
        credential:
          wallet.chainFamily === 'evm'
            ? { kind: 'evm-wallet', personalSign: wallet.personalSign }
            : { kind: 'solana-wallet', address: wallet.address, signMessage: wallet.signMessage },
      }),
    );
    const response = await send('/v1/auth/wallet/login', {
      method: 'POST',
      body: { chainFamily: wallet.chainFamily, request },
      schema: AuthResponse,
    });
    return completeLogin(response);
  }

  function rpId(): string {
    if (options.passkeyRpId) return options.passkeyRpId;
    const host = (globalThis as { location?: { hostname?: string } }).location?.hostname;
    if (!host) throw new PockeyError('unsupported', 'Passkeys need a browser page');
    return host;
  }

  async function exchangeOAuthCode(code: string): Promise<AuthResponse> {
    await ready();
    const publicKey = await withKeys((client) => client.pendingPublicKey());
    const response = await send('/v1/auth/oauth/exchange', {
      method: 'POST',
      body: { code, publicKey },
      schema: AuthResponse,
    });
    return completeLogin(response);
  }

  function oauthStartUrl(provider: OAuthProvider, sessionPublicKey: string): string {
    const query = new URLSearchParams({ publicKey: sessionPublicKey });
    return `${baseUrl}/v1/auth/oauth/${appId}/${provider}/start?${query.toString()}`;
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
      throw new PockeyError('not_found', `The user has no ${family} wallet`, {
        details: { reason: 'wallet_not_found', chainFamily: family },
      });
    }
    return wallet;
  }

  /** A wallet of the signed-in user, by id, with the key session that signs for it. */
  async function ownWallet(walletId: string): Promise<{ wallet: Wallet; keys: KeySession }> {
    await ready();
    const ks = requireKeySession();
    let wallet = user?.wallets.find((w) => w.id === walletId);
    wallet ??= (await loadUser())?.wallets.find((w) => w.id === walletId);
    if (!wallet) {
      throw new PockeyError('not_found', 'Wallet not found', {
        details: { reason: 'wallet_not_found' },
      });
    }
    return { wallet, keys: ks };
  }

  /** EVM transactions get their nonce, gas and fees (or user operation) from the API first. */
  async function prepare(
    walletId: string,
    input: SendTransactionInput,
  ): Promise<PreparedOperation> {
    if (input.chain === 'solana') return { kind: 'none' };
    return authed(walletPath(walletId, 'prepare'), {
      method: 'POST',
      body: { input },
      schema: PreparedOperation,
    });
  }

  async function stampedTransaction(walletId: string, input: SendTransactionInput) {
    const { wallet, keys: ks } = await ownWallet(walletId);
    const prepared = await prepare(walletId, input);
    const request = await withKeys((client) =>
      client.signTransaction({
        organizationId: ks.organizationId,
        address: wallet.address,
        transaction: input,
        prepared,
      }),
    );
    return { request, ...(prepared.kind === 'none' ? {} : { ticket: prepared.ticket }) };
  }

  const wallets: PockeyClient['wallets'] = {
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
    async signMessage(walletId, input) {
      const { wallet, keys: ks } = await ownWallet(walletId);
      const request = await withKeys((client) =>
        client.signMessage({
          organizationId: ks.organizationId,
          address: wallet.address,
          message: input,
        }),
      );
      return authed(walletPath(walletId, 'sign-message'), {
        method: 'POST',
        body: { input, request },
        schema: SignMessageOutput,
      });
    },
    async signTypedData(walletId, input) {
      const { wallet, keys: ks } = await ownWallet(walletId);
      const request = await withKeys((client) =>
        client.signTypedData({
          organizationId: ks.organizationId,
          address: wallet.address,
          typedData: input,
        }),
      );
      return authed(walletPath(walletId, 'sign-typed-data'), {
        method: 'POST',
        body: { input, request },
        schema: SignMessageOutput,
      });
    },
    async signTransaction(walletId, input) {
      const signed = await stampedTransaction(walletId, { ...input, sponsored: false });
      return authed(walletPath(walletId, 'sign-transaction'), {
        method: 'POST',
        body: { input, ...signed },
        schema: SignTransactionOutput,
      });
    },
    async sendTransaction(walletId, input) {
      const signed = await stampedTransaction(walletId, input);
      return authed(walletPath(walletId, 'send-transaction'), {
        method: 'POST',
        body: { input, ...signed },
        schema: SendTransactionOutput,
      });
    },
    async exportWallet(walletId) {
      const { wallet, keys: ks } = await ownWallet(walletId);
      const { request, reveal } = await withKeys((client) =>
        client.exportAccount({
          organizationId: ks.organizationId,
          address: wallet.address,
          chainFamily: wallet.chainFamily,
        }),
      );
      const out = await authed(walletPath(walletId, 'export'), {
        method: 'POST',
        body: { request },
        schema: ExportWalletOutput,
      });
      return { privateKey: await withKeys(() => reveal(out.encryptedBundle)) };
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

  /** Adds the Pockey signer to the user's sub-organization, once. */
  async function ensureSigner(ks: KeySession): Promise<string> {
    if (ks.signerUserId) return ks.signerUserId;
    const config = await client.getConfig();
    const createSigner = await withKeys((keysClient) =>
      keysClient.createSigner({
        organizationId: ks.organizationId,
        signerPublicKey: config.keyProvider.signerPublicKey,
      }),
    );
    const { signerUserId } = await authed('/v1/sessions/signer', {
      method: 'POST',
      body: { createSigner },
      schema: SignerSetupOutput,
    });
    const grant = await withKeys((keysClient) =>
      keysClient.grantRevoke({ organizationId: ks.organizationId, signerUserId }),
    );
    await authed('/v1/sessions/signer/permission', {
      method: 'POST',
      body: { request: grant },
      schema: RevokeOutput,
    });
    await setKeySession({ ...ks, signerUserId });
    return signerUserId;
  }

  const sessionPath = (sessionId: string, action = '') =>
    `/v1/sessions/${encodeURIComponent(sessionId)}${action ? `/${action}` : ''}`;

  const sessions: PockeyClient['sessions'] = {
    async create(input) {
      const { wallet, keys: ks } = await ownWallet(input.walletId);
      const signerUserId = await ensureSigner(ks);
      const account = ks.accounts[wallet.chainFamily];
      const expiresAt = new Date(Date.now() + durationToSeconds(input.policy.expiresIn) * 1000);
      const policyName = `pockey:ses:${randomToken(15)}`;
      const request = await withKeys((client) =>
        client.sessionPolicy({
          organizationId: ks.organizationId,
          policyName,
          policy: input.policy,
          walletId: account.walletId,
          address: account.address,
          signerUserId,
          expiresAt,
        }),
      );
      return authed('/v1/sessions', {
        method: 'POST',
        body: { ...input, policyName, expiresAt: expiresAt.toISOString(), request },
        schema: SessionSigner,
      });
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

  const client: PockeyClient = {
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
          throw new PockeyError('bad_request', 'Call loginWithEmail(email) before verifyOtp(code)');
        }
        return verifyEmailCode(pendingEmail, code);
      },
      loginWithWallet,

      passkey: {
        isSupported: isPasskeySupported,
        async register(registerOptions = {}) {
          await ready();
          const ks = requireKeySession();
          if (!isPasskeySupported()) {
            throw new PockeyError('unsupported', 'Passkeys are not supported in this browser');
          }
          const config = await client.getConfig();
          const label =
            user?.identities.find((identity) => identity.type === 'email')?.identifier ??
            config.appearance.name ??
            config.name;
          const name = registerOptions.name ?? label;
          const { challenge, attestation } = await createPasskey({
            rpId: rpId(),
            rpName: config.appearance.name ?? config.name,
            userName: label,
          });
          const request = await withKeys((keysClient) =>
            keysClient.addPasskey({
              organizationId: ks.organizationId,
              userId: ks.userId,
              name,
              challenge,
              attestation,
            }),
          );
          const updated = await authed('/v1/auth/passkey/register', {
            method: 'POST',
            body: { request },
            schema: EndUser,
          });
          setUser(updated);
          return updated;
        },
        async login() {
          await ready();
          if (!isPasskeySupported()) {
            throw new PockeyError('unsupported', 'Passkeys are not supported in this browser');
          }
          const config = await client.getConfig();
          const request = await withKeys((keysClient) =>
            keysClient.loginRequest({
              organizationId: config.keyProvider.organizationId,
              credential: {
                kind: 'passkey',
                assert: (challenge) => assertPasskey({ rpId: rpId(), challenge }),
              },
            }),
          );
          const response = await send('/v1/auth/passkey/login', {
            method: 'POST',
            body: { request },
            schema: AuthResponse,
          });
          return completeLogin(response);
        },
      },

      oauth: {
        startUrl: oauthStartUrl,
        exchange: exchangeOAuthCode,
        loginWithPopup(provider, popupOptions = {}) {
          // No await before window.open: browsers only allow popups inside the user
          // gesture. The popup opens blank and navigates once the session key exists.
          const host = popupHost();
          if (!host) {
            return Promise.reject(
              new PockeyError('unsupported', 'OAuth popups need a browser window'),
            );
          }
          let expectedOrigin: string;
          try {
            expectedOrigin = new URL(popupOptions.apiOrigin ?? baseUrl).origin;
          } catch {
            return Promise.reject(new PockeyError('bad_request', 'Invalid apiOrigin'));
          }
          const popup = openPopup(host, 'about:blank');
          if (!popup) {
            return Promise.reject(
              new PockeyError('popup_blocked', 'The browser blocked the sign-in popup'),
            );
          }
          return (async () => {
            try {
              const publicKey = await withKeys((keysClient) => keysClient.pendingPublicKey());
              popup.location.href = oauthStartUrl(provider, publicKey);
            } catch (error) {
              popup.close();
              throw error;
            }
            const code = await waitForOAuthCode(host, popup, {
              expectedOrigin,
              timeoutMs: popupOptions.timeoutMs ?? OAUTH_POPUP_TIMEOUT_MS,
            });
            return exchangeOAuthCode(code);
          })();
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
        pendingOtp = null;
        // clearSession emits when state remains; a session lost during the call already emitted.
        await clearSession();
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
