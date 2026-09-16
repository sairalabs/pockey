import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPocketkey, type PocketkeyClient } from './client.js';
import { isPocketkeyError } from './errors.js';
import { memoryStorage } from './storage.js';
import { APP_ID, authResponse, BASE_URL, fakeApi, json, type FakeApi } from './test-utils.js';

const CODE = 'c'.repeat(43);

interface FakePopup {
  closed: boolean;
  close: () => void;
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
let pk: PocketkeyClient;
let popup: FakePopup;

beforeEach(() => {
  vi.useFakeTimers();
  api = fakeApi();
  api.on('POST', '/v1/auth/oauth/exchange', () => json(authResponse()));
  pk = createPocketkey({
    appId: APP_ID,
    baseUrl: BASE_URL,
    storage: memoryStorage(),
    fetch: api.fetch,
  });
  popup = { closed: false, close: vi.fn() };
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
  it('builds the start url', () => {
    expect(pk.auth.oauth.startUrl('google')).toBe(
      `${BASE_URL}/v1/auth/oauth/${APP_ID}/google/start`,
    );
  });

  it('opens synchronously, ignores foreign messages, then exchanges the code', async () => {
    const win = fakeWindow(popup);
    vi.stubGlobal('window', win);

    const pending = pk.auth.oauth.loginWithPopup('google');
    // Opened before any await, inside the user gesture.
    expect(win.open).toHaveBeenCalledWith(
      `${BASE_URL}/v1/auth/oauth/${APP_ID}/google/start`,
      'pocketkey-oauth',
      expect.stringContaining('popup'),
    );

    win.post({ type: 'pocketkey:oauth', code: CODE }, 'https://evil.example', popup);
    win.post({ type: 'pocketkey:oauth', code: CODE }, BASE_URL, { closed: false });
    win.post({ type: 'something-else' }, BASE_URL, popup);
    await Promise.resolve();
    expect(api.count('POST', '/v1/auth/oauth/exchange')).toBe(0);
    expect(win.listeners.size).toBe(1);

    win.post({ type: 'pocketkey:oauth', code: CODE }, BASE_URL, popup);
    const result = await pending;
    expect(result.user.id).toBeTruthy();
    expect(api.last('POST', '/v1/auth/oauth/exchange')?.body).toEqual({ code: CODE });
    expect(pk.auth.isAuthenticated()).toBe(true);
    expect(win.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('honors apiOrigin', async () => {
    const win = fakeWindow(popup);
    vi.stubGlobal('window', win);
    const pending = pk.auth.oauth.loginWithPopup('apple', { apiOrigin: 'https://auth.test.dev/x' });
    win.post({ type: 'pocketkey:oauth', code: CODE }, BASE_URL, popup);
    win.post({ type: 'pocketkey:oauth', code: CODE }, 'https://auth.test.dev', popup);
    await pending;
    expect(api.count('POST', '/v1/auth/oauth/exchange')).toBe(1);
  });

  it('rejects user_rejected when the popup is closed', async () => {
    const win = fakeWindow(popup);
    vi.stubGlobal('window', win);
    const pending = settle(pk.auth.oauth.loginWithPopup('google'));

    popup.closed = true;
    await vi.advanceTimersByTimeAsync(1000);
    const { error } = await pending;
    expect(isPocketkeyError(error) && error.code).toBe('user_rejected');
    expect(win.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(api.count('POST', '/v1/auth/oauth/exchange')).toBe(0);
  });

  it('rejects popup_blocked when window.open returns null', async () => {
    vi.stubGlobal('window', fakeWindow(null));
    const { error } = await settle(pk.auth.oauth.loginWithPopup('google'));
    expect(isPocketkeyError(error) && error.code).toBe('popup_blocked');
  });

  it('rejects unsupported outside browsers', async () => {
    const { error } = await settle(pk.auth.oauth.loginWithPopup('google'));
    expect(isPocketkeyError(error) && error.code).toBe('unsupported');
  });

  it('surfaces the provider error', async () => {
    const win = fakeWindow(popup);
    vi.stubGlobal('window', win);
    const pending = settle(pk.auth.oauth.loginWithPopup('google'));
    win.post({ type: 'pocketkey:oauth', error: 'no_session' }, BASE_URL, popup);
    const { error } = await pending;
    expect(isPocketkeyError(error) && error.code).toBe('unauthorized');
    expect(isPocketkeyError(error) && error.details).toEqual({ providerError: 'no_session' });
    expect(win.listeners.size).toBe(0);
  });

  it('times out, closes the popup and cleans up', async () => {
    const win = fakeWindow(popup);
    vi.stubGlobal('window', win);
    const pending = settle(pk.auth.oauth.loginWithPopup('google', { timeoutMs: 10_000 }));
    await vi.advanceTimersByTimeAsync(10_000);
    const { error } = await pending;
    expect(isPocketkeyError(error) && error.code).toBe('user_rejected');
    expect(popup.close).toHaveBeenCalled();
    expect(win.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
