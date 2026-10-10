import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPockey, type PockeyClient } from './client.js';
import { isPockeyError } from './errors.js';
import { memoryStorage } from './storage.js';
import {
  APP_ID,
  authResponse,
  BASE_URL,
  fakeApi,
  fakeKeys,
  json,
  PENDING_PUBLIC_KEY,
  type FakeApi,
  type FakeKeys,
} from './test-utils.js';

const CODE = 'c'.repeat(43);
const startUrl = (provider: string) =>
  `${BASE_URL}/v1/auth/oauth/${APP_ID}/${provider}/start?publicKey=${PENDING_PUBLIC_KEY}`;

interface FakePopup {
  closed: boolean;
  close: () => void;
  location: { href: string };
}

type Listener = (event: MessageEvent) => void;

function fakeWindow(popup: FakePopup | null) {
  const listeners = new Set<Listener>();
  return {
    listeners,
    open: vi.fn((_url: string, _target: string, _features: string) => popup),
    addEventListener: vi.fn((_type: string, listener: Listener) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: Listener) => listeners.delete(listener)),
    post(data: unknown, origin: string, source: unknown) {
      const event = { data, origin, source } as unknown as MessageEvent;
      for (const listener of [...listeners]) listener(event);
    },
  };
}

let api: FakeApi;
let keys: FakeKeys;
let pk: PockeyClient;
let popup: FakePopup;

/** Lets the popup navigate: the session key is fetched after `window.open`. */
async function navigated(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  api = fakeApi();
  keys = fakeKeys();
  api.on('POST', '/v1/auth/oauth/exchange', () => json(authResponse()));
  pk = createPockey({
    appId: APP_ID,
    baseUrl: BASE_URL,
    storage: memoryStorage(),
    fetch: api.fetch,
    keys: keys.keys,
  });
  popup = { closed: false, close: vi.fn(), location: { href: 'about:blank' } };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function settle<T>(promise: Promise<T>): Promise<{ value?: T; error?: unknown }> {
  try {
    return { value: await promise };
  } catch (error) {
    return { error };
  }
}

describe('OAuth popup', () => {
  it('builds the start url with the session public key', () => {
    expect(pk.auth.oauth.startUrl('google', PENDING_PUBLIC_KEY)).toBe(startUrl('google'));
  });

  it('opens blank synchronously, navigates with the key, ignores foreign messages, then exchanges', async () => {
    const win = fakeWindow(popup);
    vi.stubGlobal('window', win);

    const pending = pk.auth.oauth.loginWithPopup('google');
    // Opened before any await, inside the user gesture, then navigated once the key exists.
    expect(win.open).toHaveBeenCalledWith(
      'about:blank',
      'pockey-oauth',
      expect.stringContaining('popup'),
    );
    await navigated();
    expect(popup.location.href).toBe(startUrl('google'));
    expect(keys.methods()).toEqual(['pendingPublicKey']);

    win.post({ type: 'pockey:oauth', code: CODE }, 'https://evil.example', popup);
    win.post({ type: 'pockey:oauth', code: CODE }, BASE_URL, { closed: false });
    win.post({ type: 'something-else' }, BASE_URL, popup);
    await Promise.resolve();
    expect(api.count('POST', '/v1/auth/oauth/exchange')).toBe(0);
    expect(win.listeners.size).toBe(1);

    win.post({ type: 'pockey:oauth', code: CODE }, BASE_URL, popup);
    const result = await pending;
    expect(result.user.id).toBeTruthy();
    expect(api.last('POST', '/v1/auth/oauth/exchange')?.body).toEqual({
      code: CODE,
      publicKey: PENDING_PUBLIC_KEY,
    });
    expect(keys.methods()).toEqual(['pendingPublicKey', 'pendingPublicKey', 'activate']);
    expect(pk.auth.isAuthenticated()).toBe(true);
    expect(win.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('exchange sends the code with the pending public key', async () => {
    const response = await pk.auth.oauth.exchange(CODE);
    expect(api.last('POST', '/v1/auth/oauth/exchange')?.body).toEqual({
      code: CODE,
      publicKey: PENDING_PUBLIC_KEY,
    });
    expect(pk.auth.getUser()?.id).toBe(response.user.id);
    expect(keys.state.active).toBe(true);
  });

  it('closes the popup when the key client fails', async () => {
    vi.stubGlobal('window', fakeWindow(popup));
    keys.fail('pendingPublicKey', new Error('no storage'));
    const { error } = await settle(pk.auth.oauth.loginWithPopup('google'));
    expect(isPockeyError(error) && error.code).toBe('internal');
    expect(popup.close).toHaveBeenCalled();
    expect(popup.location.href).toBe('about:blank');
  });

  it('honors apiOrigin', async () => {
    const win = fakeWindow(popup);
    vi.stubGlobal('window', win);
    const pending = pk.auth.oauth.loginWithPopup('apple', { apiOrigin: 'https://auth.test.dev/x' });
    await navigated();
    win.post({ type: 'pockey:oauth', code: CODE }, BASE_URL, popup);
    win.post({ type: 'pockey:oauth', code: CODE }, 'https://auth.test.dev', popup);
    await pending;
    expect(api.count('POST', '/v1/auth/oauth/exchange')).toBe(1);
  });

  it('rejects user_rejected when the popup is closed', async () => {
    const win = fakeWindow(popup);
    vi.stubGlobal('window', win);
    const pending = settle(pk.auth.oauth.loginWithPopup('google'));
    await navigated();

    popup.closed = true;
    await vi.advanceTimersByTimeAsync(1000);
    const { error } = await pending;
    expect(isPockeyError(error) && error.code).toBe('user_rejected');
    expect(win.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(api.count('POST', '/v1/auth/oauth/exchange')).toBe(0);
    expect(keys.methods()).not.toContain('activate');
  });

  it('rejects popup_blocked when window.open returns null', async () => {
    vi.stubGlobal('window', fakeWindow(null));
    const { error } = await settle(pk.auth.oauth.loginWithPopup('google'));
    expect(isPockeyError(error) && error.code).toBe('popup_blocked');
    expect(keys.methods()).toEqual([]);
  });

  it('rejects unsupported outside browsers', async () => {
    const { error } = await settle(pk.auth.oauth.loginWithPopup('google'));
    expect(isPockeyError(error) && error.code).toBe('unsupported');
  });

  it('surfaces the provider error', async () => {
    const win = fakeWindow(popup);
    vi.stubGlobal('window', win);
    const pending = settle(pk.auth.oauth.loginWithPopup('google'));
    await navigated();
    win.post({ type: 'pockey:oauth', error: 'no_session' }, BASE_URL, popup);
    const { error } = await pending;
    expect(isPockeyError(error) && error.code).toBe('unauthorized');
    expect(isPockeyError(error) && error.details).toEqual({ providerError: 'no_session' });
    expect(win.listeners.size).toBe(0);
  });

  it('times out, closes the popup and cleans up', async () => {
    const win = fakeWindow(popup);
    vi.stubGlobal('window', win);
    const pending = settle(pk.auth.oauth.loginWithPopup('google', { timeoutMs: 10_000 }));
    await navigated();
    await vi.advanceTimersByTimeAsync(10_000);
    const { error } = await pending;
    expect(isPockeyError(error) && error.code).toBe('user_rejected');
    expect(popup.close).toHaveBeenCalled();
    expect(win.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
