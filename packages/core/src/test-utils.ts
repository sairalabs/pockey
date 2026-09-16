/* Test helpers only: not exported from the package entry. */
import { EndUser, Wallet, type AuthResponse, type AuthTokens } from '@pocketkey/types';

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

export function endUser(wallets: Wallet[] = [wallet('evm'), wallet('solana')]): EndUser {
  return EndUser.parse({
    id: `usr_${pad('u', 24)}`,
    appId: `app_${pad('a', 24)}`,
    identities: [],
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

export function authResponse(user: EndUser = endUser(), ttlMs?: number): AuthResponse {
  return { ...tokens(ttlMs), user, isNewUser: false };
}
