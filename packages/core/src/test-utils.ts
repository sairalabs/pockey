/* Test helpers only: not exported from the package entry. */
import {
  EndUser,
  Wallet,
  type AuthResponse,
  type AuthTokens,
  type ClientSignature,
  type KeySession,
  PublicAppConfig,
  type StampedRequest,
} from '@pocketkey/types';
import type { KeyClient } from './keys.js';

const pad = (seed: string, length: number) => seed.padEnd(length, '0').slice(0, length);

export const APP_ID = `pk_app_${pad('testapp', 24)}`;
export const BASE_URL = 'https://api.test.dev';

export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

export type Handler = (request: RecordedRequest) => Response | Promise<Response>;

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export function apiError(code: string, status: number, details?: unknown): Response {
  return json(
    { error: { code, message: `${code} happened`, requestId: 'req_test', details } },
    status,
  );
}

/** A fake `fetch` routing on `METHOD /path`. Unrouted requests answer 404 `not_found`. */
export function fakeApi() {
  const routes = new Map<string, Handler>();
  const calls: RecordedRequest[] = [];

  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input : input.url,
    );
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    const rawBody = init?.body;
    const recorded: RecordedRequest = {
      method: init?.method ?? 'GET',
      path: url.pathname,
      headers,
      body: typeof rawBody === 'string' ? JSON.parse(rawBody) : undefined,
    };
    calls.push(recorded);
    const handler = routes.get(`${recorded.method} ${recorded.path}`);
    if (!handler) return apiError('not_found', 404);
    return handler(recorded);
  };

  return {
    fetch,
    calls,
    on(method: string, path: string, handler: Handler) {
      routes.set(`${method} ${path}`, handler);
    },
    count(method: string, path: string): number {
      return calls.filter((call) => call.method === method && call.path === path).length;
    },
    last(method: string, path: string): RecordedRequest | undefined {
      return calls.filter((call) => call.method === method && call.path === path).at(-1);
    },
    /** `METHOD /path` of every call, in order. */
    routes(): string[] {
      return calls.map((call) => `${call.method} ${call.path}`);
    },
  };
}

export type FakeApi = ReturnType<typeof fakeApi>;

export function wallet(family: 'evm' | 'solana'): Wallet {
  return Wallet.parse({
    id: `wlt_${pad(`w${family}`, 24)}`,
    endUserId: `usr_${pad('u', 24)}`,
    chainFamily: family,
    address:
      family === 'evm'
        ? '0x1111111111111111111111111111111111111111'
        : '11111111111111111111111111111111',
    smartAccountAddress: null,
    createdAt: '2026-09-16T10:00:00.000Z',
  });
}

export function endUser(
  wallets: Wallet[] = [wallet('evm'), wallet('solana')],
  identities: unknown[] = [],
): EndUser {
  return EndUser.parse({
    id: `usr_${pad('u', 24)}`,
    appId: `app_${pad('a', 24)}`,
    identities,
    wallets,
    createdAt: '2026-09-16T10:00:00.000Z',
    lastActiveAt: null,
  });
}

let counter = 0;

/** Fresh, distinct tokens. The access token expires `ttlMs` from the (possibly faked) clock. */
export function tokens(ttlMs = 15 * 60_000): AuthTokens {
  counter += 1;
  const n = String(counter);
  return {
    accessToken: `header.payload${n}.signature`,
    accessTokenExpiresAt: new Date(Date.now() + ttlMs).toISOString(),
    refreshToken: `pk_rt_${pad(`r${n}`, 43)}`,
    refreshTokenExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  };
}

/** Key session of the default user: accounts mirror `wallet('evm')` and `wallet('solana')`. */
export function keySession(overrides: Partial<KeySession> = {}): KeySession {
  return {
    organizationId: 'org_user_sub',
    userId: 'tk_user',
    signerUserId: null,
    accounts: {
      evm: { walletId: 'tk_wallet_evm', address: wallet('evm').address },
      solana: { walletId: 'tk_wallet_solana', address: wallet('solana').address },
    },
    ...overrides,
  };
}

export function authResponse(
  user: EndUser = endUser(),
  ttlMs?: number,
  session: KeySession = keySession(),
): AuthResponse {
  return { ...tokens(ttlMs), user, isNewUser: false, keySession: session };
}

export const PARENT_ORG = 'org_parent';
export const SIGNER_PUBLIC_KEY = `03${'b'.repeat(64)}`;

export function appConfig(overrides: Partial<PublicAppConfig> = {}): PublicAppConfig {
  return PublicAppConfig.parse({
    appId: APP_ID,
    name: 'Test',
    loginMethods: ['email', 'google', 'passkey', 'wallet'],
    chains: { evm: [8453], solana: [] },
    appearance: { theme: 'system', accent: '#d2042d' },
    embeddedWallets: { createOnLogin: 'all' },
    allowedOrigins: [],
    keyProvider: {
      kind: 'emulator',
      organizationId: PARENT_ORG,
      signerPublicKey: SIGNER_PUBLIC_KEY,
    },
    ...overrides,
  });
}

/* Fake KeyClient: deterministic stamped requests, every call recorded in order. */

export const PENDING_PUBLIC_KEY = `02${'a'.repeat(64)}`;
export const EXPORTED_KEY = `0x${'ee'.repeat(32)}`;

/** A deterministic stamped request for `activity` (`/public/v1/submit/<activity>`). */
export function stamped(activity: string, payload: unknown = {}): StampedRequest {
  return {
    path: `/public/v1/submit/${activity}`,
    body: JSON.stringify({ activity, payload }),
    stamp: { header: 'X-Stamp', value: `stamp:${activity}` },
  };
}

export const clientSignature = (message: string): ClientSignature => ({
  publicKey: PENDING_PUBLIC_KEY,
  scheme: 'CLIENT_SIGNATURE_SCHEME_API_P256',
  message,
  signature: 'c'.repeat(128),
});

export interface KeyCall {
  method: keyof KeyClient;
  input: unknown;
}

/** Rejection shaped like `KeyClientError` from `@pocketkey/key-provider/client`. */
export function keyError(reason: string, message = `key client: ${reason}`): Error {
  return Object.assign(new Error(message), { name: 'KeyClientError', reason });
}

export function fakeKeys(options: { active?: boolean } = {}) {
  const state = { active: options.active ?? false, pending: false };
  const calls: KeyCall[] = [];
  const failures = new Map<keyof KeyClient, unknown>();
  const exportBundles: string[] = [];

  async function record<T>(
    method: keyof KeyClient,
    input: unknown,
    run: () => T | Promise<T>,
  ): Promise<T> {
    calls.push({ method, input });
    if (failures.has(method)) throw failures.get(method);
    return run();
  }

  const needsActive = () => {
    if (!state.active) throw keyError('no_session');
  };

  const keys: KeyClient = {
    hasSession: () => record('hasSession', undefined, () => state.active),
    pendingPublicKey: () =>
      record('pendingPublicKey', undefined, () => {
        state.pending = true;
        return PENDING_PUBLIC_KEY;
      }),
    activate: () =>
      record('activate', undefined, () => {
        state.active = true;
        state.pending = false;
      }),
    clear: () =>
      record('clear', undefined, () => {
        state.active = false;
        state.pending = false;
      }),
    encryptOtp: (input) => record('encryptOtp', input, () => `encrypted:${input.code}`),
    signupProof: (input) =>
      record('signupProof', input, () => ({
        sessionKey: {
          apiKeyName: 'session-1',
          publicKey: PENDING_PUBLIC_KEY,
          curveType: 'API_KEY_CURVE_P256' as const,
          expirationSeconds: '2592000',
        },
        clientSignature: clientSignature(`signup:${input.verificationToken}`),
      })),
    loginProof: (input) =>
      record('loginProof', input, () => ({
        publicKey: PENDING_PUBLIC_KEY,
        clientSignature: clientSignature(`login:${input.verificationToken}`),
      })),
    loginRequest: (input) =>
      record('loginRequest', input, async () => {
        // Like the real client, a passkey asserts over the login request.
        if (input.credential.kind === 'passkey') {
          await input.credential.assert(new Uint8Array(32).fill(7));
        }
        return stamped('stamp_login', { organizationId: input.organizationId });
      }),
    signMessage: (input) =>
      record('signMessage', input, () => {
        needsActive();
        return stamped('sign_raw_payload', input.message);
      }),
    signTypedData: (input) =>
      record('signTypedData', input, () => {
        needsActive();
        return stamped('sign_raw_payload', { typed: input.address });
      }),
    signTransaction: (input) =>
      record('signTransaction', input, () => {
        needsActive();
        return stamped('sign_transaction', { kind: input.prepared.kind });
      }),
    exportAccount: (input) =>
      record('exportAccount', input, () => {
        needsActive();
        return {
          request: stamped('export_wallet_account', { address: input.address }),
          reveal: async (bundle: string) => {
            exportBundles.push(bundle);
            return EXPORTED_KEY;
          },
        };
      }),
    createSigner: (input) =>
      record('createSigner', input, () => {
        needsActive();
        return stamped('create_users', input);
      }),
    grantRevoke: (input) =>
      record('grantRevoke', input, () => {
        needsActive();
        return stamped('create_policy', { grant: input.signerUserId });
      }),
    sessionPolicy: (input) =>
      record('sessionPolicy', input, () => {
        needsActive();
        return stamped('create_policy', { policyName: input.policyName });
      }),
    addPasskey: (input) =>
      record('addPasskey', input, () => {
        needsActive();
        return stamped('create_authenticators', { name: input.name });
      }),
  };

  return {
    keys,
    state,
    calls,
    exportBundles,
    /** Method names in call order, `hasSession` left out unless asked. */
    methods(withHasSession = false): string[] {
      return calls
        .map((call) => call.method)
        .filter((method) => withHasSession || method !== 'hasSession');
    },
    inputOf<M extends keyof KeyClient>(method: M): Parameters<KeyClient[M]>[0] | undefined {
      return calls.filter((call) => call.method === method).at(-1)?.input as
        Parameters<KeyClient[M]>[0] | undefined;
    },
    /** Makes every later call of `method` reject with `error`. */
    fail(method: keyof KeyClient, error: unknown) {
      failures.set(method, error);
    },
  };
}

export type FakeKeys = ReturnType<typeof fakeKeys>;

/** Routes the three email OTP steps. `mode` picks sign-up or login. */
export function routeEmailLogin(
  api: FakeApi,
  options: { user?: EndUser; mode?: 'signup' | 'login'; session?: KeySession } = {},
): void {
  api.on('POST', '/v1/auth/email/start', () =>
    json({ otpId: 'otp_1', targetBundle: '{"target":"bundle"}' }),
  );
  api.on('POST', '/v1/auth/email/verify', () =>
    json({ verificationToken: 'vtoken', mode: options.mode ?? 'login' }),
  );
  api.on('POST', '/v1/auth/email/login', () =>
    json(authResponse(options.user, undefined, options.session)),
  );
}
