import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPocketkey, type PocketkeyClient } from './client.js';
import { isPocketkeyError } from './errors.js';
import { memoryStorage } from './storage.js';
import {
  APP_ID,
  authResponse,
  BASE_URL,
  endUser,
  fakeApi,
  json,
  type FakeApi,
} from './test-utils.js';

const webauthn = vi.hoisted(() => ({
  startRegistration: vi.fn(),
  startAuthentication: vi.fn(),
}));
vi.mock('@simplewebauthn/browser', () => webauthn);

const registerOptions = {
  challenge: 'chal',
  rp: { name: 'Pocketkey', id: 'localhost' },
  user: { id: 'dXNlcg', name: 'a@test.dev', displayName: 'a' },
  pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
};

let api: FakeApi;
let pk: PocketkeyClient;

function stubBrowser() {
  vi.stubGlobal('PublicKeyCredential', function PublicKeyCredential() {
    return undefined;
  });
  vi.stubGlobal('navigator', { credentials: {} });
}

beforeEach(() => {
  api = fakeApi();
  pk = createPocketkey({
    appId: APP_ID,
    baseUrl: BASE_URL,
    storage: memoryStorage(),
    fetch: api.fetch,
  });
  webauthn.startRegistration.mockReset();
  webauthn.startAuthentication.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('passkeys', () => {
  it('reports unsupported in Node without throwing', async () => {
    expect(pk.auth.passkey.isSupported()).toBe(false);
    const login = await pk.auth.passkey.login().catch((e: unknown) => e);
    expect(isPocketkeyError(login) && login.code).toBe('unsupported');
  });

  it('logs in with the bridged challenge cookie', async () => {
    stubBrowser();
    api.on('GET', '/v1/auth/passkey/generate-authenticate-options', () =>
      json({ challenge: 'abc', rpId: 'localhost' }, 200, {
        'X-Pocketkey-Auth-Cookies': 'challenge=1',
      }),
    );
    api.on('POST', '/v1/auth/passkey/verify-authentication', () => json(authResponse()));
    webauthn.startAuthentication.mockResolvedValue({ id: 'cred' });

    const result = await pk.auth.passkey.login();
    expect(webauthn.startAuthentication).toHaveBeenCalledWith({
      optionsJSON: { challenge: 'abc', rpId: 'localhost' },
    });
    const verify = api.last('POST', '/v1/auth/passkey/verify-authentication');
    expect(verify?.body).toEqual({ response: { id: 'cred' } });
    expect(verify?.headers['x-pocketkey-auth-cookies']).toBe('challenge=1');
    expect(pk.auth.getUser()?.id).toBe(result.user.id);
  });

  it('maps NotAllowedError to user_rejected', async () => {
    stubBrowser();
    api.on('GET', '/v1/auth/passkey/generate-authenticate-options', () =>
      json({ challenge: 'abc' }),
    );
    const denied = new Error('The operation either timed out or was not allowed.');
    denied.name = 'NotAllowedError';
    webauthn.startAuthentication.mockRejectedValue(denied);

    const error = await pk.auth.passkey.login().catch((e: unknown) => e);
    expect(isPocketkeyError(error) && error.code).toBe('user_rejected');
    expect(api.count('POST', '/v1/auth/passkey/verify-authentication')).toBe(0);
  });

  it('registers a passkey for the signed-in user and returns the refreshed user', async () => {
    stubBrowser();
    api.on('POST', '/v1/auth/email-otp/send-verification-otp', () => json({ success: true }));
    api.on('POST', '/v1/auth/sign-in/email-otp', () =>
      json(authResponse(), 200, { 'X-Pocketkey-Auth-Cookies': 's=1' }),
    );
    await pk.auth.loginWithEmail('a@test.dev');
    await pk.auth.verifyOtp('123456');

    const refreshed = endUser();
    api.on('GET', '/v1/auth/passkey/generate-register-options', () => json(registerOptions));
    api.on('POST', '/v1/auth/passkey/verify-registration', () =>
      json({ id: 'pk1', name: 'Laptop' }),
    );
    api.on('GET', '/v1/me', () => json({ user: refreshed }));
    webauthn.startRegistration.mockResolvedValue({ id: 'cred' });

    expect(await pk.auth.passkey.register({ name: 'Laptop' })).toEqual(refreshed);
    expect(
      api.last('GET', '/v1/auth/passkey/generate-register-options')?.headers[
        'x-pocketkey-auth-cookies'
      ],
    ).toBe('s=1');
    expect(api.last('POST', '/v1/auth/passkey/verify-registration')?.body).toEqual({
      response: { id: 'cred' },
      name: 'Laptop',
    });
  });

  it('refuses malformed registration options', async () => {
    stubBrowser();
    api.on('POST', '/v1/auth/email-otp/send-verification-otp', () => json({ success: true }));
    api.on('POST', '/v1/auth/sign-in/email-otp', () => json(authResponse()));
    await pk.auth.loginWithEmail('a@test.dev');
    await pk.auth.verifyOtp('123456');
    api.on('GET', '/v1/auth/passkey/generate-register-options', () => json({ challenge: '' }));

    const error = await pk.auth.passkey.register().catch((e: unknown) => e);
    expect(isPocketkeyError(error) && error.code).toBe('invalid_response');
    expect(webauthn.startRegistration).not.toHaveBeenCalled();
  });
});
