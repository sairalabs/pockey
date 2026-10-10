import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPockey, type PockeyClient } from './client.js';
import { isPockeyError } from './errors.js';
import { assertPasskey, createPasskey } from './passkey.js';
import { memoryStorage } from './storage.js';
import {
  APP_ID,
  appConfig,
  authResponse,
  BASE_URL,
  endUser,
  fakeApi,
  fakeKeys,
  json,
  keySession,
  PARENT_ORG,
  routeEmailLogin,
  stamped,
  type FakeApi,
  type FakeKeys,
} from './test-utils.js';

const webauthn = vi.hoisted(() => ({
  startRegistration: vi.fn(),
  startAuthentication: vi.fn(),
}));
vi.mock('@simplewebauthn/browser', () => webauthn);

const RP_ID = 'embed.test.dev';
/** base64url of the 32 bytes of 7 the fake key client asserts over. */
const CHALLENGE = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc';

const assertion = {
  id: 'cred',
  response: { clientDataJSON: 'cd', authenticatorData: 'ad', signature: 'sig' },
};

let api: FakeApi;
let keys: FakeKeys;
let pk: PockeyClient;

function stubBrowser() {
  vi.stubGlobal('PublicKeyCredential', function PublicKeyCredential() {
    return undefined;
  });
  vi.stubGlobal('navigator', { credentials: {} });
}

async function signIn(user = endUser()) {
  routeEmailLogin(api, { user });
  await pk.auth.loginWithEmail('a@test.dev');
  await pk.auth.verifyOtp('123456');
}

beforeEach(() => {
  api = fakeApi();
  keys = fakeKeys();
  api.on('GET', `/v1/apps/${APP_ID}/config`, () => json(appConfig()));
  pk = createPockey({
    appId: APP_ID,
    baseUrl: BASE_URL,
    storage: memoryStorage(),
    fetch: api.fetch,
    keys: keys.keys,
    passkeyRpId: RP_ID,
  });
  webauthn.startRegistration.mockReset();
  webauthn.startAuthentication.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('passkey login', () => {
  it('reports unsupported in Node without throwing', async () => {
    expect(pk.auth.passkey.isSupported()).toBe(false);
    const login = await pk.auth.passkey.login().catch((e: unknown) => e);
    expect(isPockeyError(login) && login.code).toBe('unsupported');
    expect(api.calls).toHaveLength(0);
  });

  it('asserts over the login request of the parent organization and posts it', async () => {
    stubBrowser();
    api.on('POST', '/v1/auth/passkey/login', () => json(authResponse()));
    webauthn.startAuthentication.mockResolvedValue(assertion);

    const result = await pk.auth.passkey.login();

    expect(keys.inputOf('loginRequest')).toMatchObject({
      organizationId: PARENT_ORG,
      credential: { kind: 'passkey' },
    });
    expect(webauthn.startAuthentication).toHaveBeenCalledWith({
      optionsJSON: expect.objectContaining({
        challenge: CHALLENGE,
        rpId: RP_ID,
        allowCredentials: [],
      }),
    });
    expect(api.last('POST', '/v1/auth/passkey/login')?.body).toEqual({
      request: stamped('stamp_login', { organizationId: PARENT_ORG }),
    });
    expect(keys.methods()).toEqual(['loginRequest', 'activate']);
    expect(pk.auth.getUser()?.id).toBe(result.user.id);
  });

  it('maps NotAllowedError to user_rejected', async () => {
    stubBrowser();
    const denied = new Error('The operation either timed out or was not allowed.');
    denied.name = 'NotAllowedError';
    webauthn.startAuthentication.mockRejectedValue(denied);

    const error = await pk.auth.passkey.login().catch((e: unknown) => e);
    expect(isPockeyError(error) && error.code).toBe('user_rejected');
    expect(api.count('POST', '/v1/auth/passkey/login')).toBe(0);
    expect(keys.methods()).not.toContain('activate');
  });

  it('needs a relying party id outside a page', async () => {
    stubBrowser();
    const noRp = createPockey({
      appId: APP_ID,
      baseUrl: BASE_URL,
      storage: memoryStorage(),
      fetch: api.fetch,
      keys: keys.keys,
    });
    const error = await noRp.auth.passkey.login().catch((e: unknown) => e);
    expect(isPockeyError(error) && error.code).toBe('unsupported');
    expect(webauthn.startAuthentication).not.toHaveBeenCalled();
  });
});

describe('passkey registration', () => {
  it('creates the passkey locally, stamps addPasskey and returns the updated user', async () => {
    stubBrowser();
    const user = endUser(undefined, [
      {
        id: `idn_${'i'.repeat(24)}`,
        type: 'email',
        identifier: 'a@test.dev',
        verifiedAt: '2026-09-16T10:00:00.000Z',
      },
    ]);
    await signIn(user);
    const updated = endUser();
    api.on('POST', '/v1/auth/passkey/register', () => json(updated));
    webauthn.startRegistration.mockResolvedValue({
      id: 'cred',
      response: {
        clientDataJSON: 'cd',
        attestationObject: 'ao',
        transports: ['internal', 'hybrid'],
      },
    });

    expect(await pk.auth.passkey.register({ name: 'Laptop' })).toEqual(updated);
    expect(pk.auth.getUser()).toEqual(updated);

    const options = webauthn.startRegistration.mock.calls[0]?.[0] as {
      optionsJSON: { challenge: string; rp: unknown; user: { name: string } };
    };
    expect(options.optionsJSON.rp).toEqual({ id: RP_ID, name: 'Test' });
    expect(options.optionsJSON.user.name).toBe('a@test.dev');
    expect(keys.inputOf('addPasskey')).toEqual({
      organizationId: keySession().organizationId,
      userId: keySession().userId,
      name: 'Laptop',
      challenge: options.optionsJSON.challenge,
      attestation: {
        credentialId: 'cred',
        clientDataJson: 'cd',
        attestationObject: 'ao',
        transports: ['AUTHENTICATOR_TRANSPORT_INTERNAL', 'AUTHENTICATOR_TRANSPORT_HYBRID'],
      },
    });
    expect(api.last('POST', '/v1/auth/passkey/register')?.body).toEqual({
      request: stamped('create_authenticators', { name: 'Laptop' }),
    });
  });

  it('defaults the name to the app name and refuses when logged out', async () => {
    stubBrowser();
    const loggedOut = await pk.auth.passkey.register().catch((e: unknown) => e);
    expect(isPockeyError(loggedOut) && loggedOut.code).toBe('not_authenticated');

    await signIn();
    api.on('POST', '/v1/auth/passkey/register', () => json(endUser()));
    webauthn.startRegistration.mockResolvedValue({
      id: 'cred',
      response: { clientDataJSON: 'cd', attestationObject: 'ao' },
    });
    await pk.auth.passkey.register();
    expect(keys.inputOf('addPasskey')).toMatchObject({
      name: 'Test',
      attestation: { transports: [] },
    });
  });

  it('does not stamp anything when the ceremony is cancelled', async () => {
    stubBrowser();
    await signIn();
    const denied = new Error('cancelled');
    denied.name = 'NotAllowedError';
    webauthn.startRegistration.mockRejectedValue(denied);
    const error = await pk.auth.passkey.register().catch((e: unknown) => e);
    expect(isPockeyError(error) && error.code).toBe('user_rejected');
    expect(keys.methods()).not.toContain('addPasskey');
    expect(api.count('POST', '/v1/auth/passkey/register')).toBe(0);
  });
});

describe('passkey ceremonies', () => {
  it('createPasskey asks for a discoverable ES256 credential', async () => {
    const run = vi.fn().mockResolvedValue({
      id: 'cred',
      response: { clientDataJSON: 'cd', attestationObject: 'ao', transports: ['usb', 'weird'] },
    });
    const out = await createPasskey({ rpId: RP_ID, rpName: 'App', userName: 'a@test.dev', run });
    const options = run.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(options).toMatchObject({
      challenge: out.challenge,
      rp: { id: RP_ID, name: 'App' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: { residentKey: 'required' },
    });
    expect(out.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(out.attestation.transports).toEqual([
      'AUTHENTICATOR_TRANSPORT_USB',
      'AUTHENTICATOR_TRANSPORT_INTERNAL',
    ]);
  });

  it('assertPasskey encodes the challenge and returns the assertion fields', async () => {
    const run = vi.fn().mockResolvedValue(assertion);
    const out = await assertPasskey({ rpId: RP_ID, challenge: new Uint8Array(32).fill(7), run });
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ challenge: CHALLENGE, rpId: RP_ID }),
    );
    expect(out).toEqual({
      credentialId: 'cred',
      clientDataJson: 'cd',
      authenticatorData: 'ad',
      signature: 'sig',
    });
  });
});
