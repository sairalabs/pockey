import { AuthResponse } from '@pocketkey/types';
import { beforeAll, describe, expect, it } from 'vitest';
import { AUTH_COOKIES_HEADER } from '../src/auth/cookie-bridge.js';
import { EMBED_ORIGIN, loginWithEmail, postJson, request, seedDb, withApp } from './helpers.js';
import { SoftwareAuthenticator } from './webauthn.js';

beforeAll(async () => {
  await seedDb();
});

function getJson(path: string, authCookies: string) {
  return request(path, {
    headers: withApp({
      Origin: EMBED_ORIGIN,
      ...(authCookies ? { [AUTH_COOKIES_HEADER]: authCookies } : {}),
    }),
  });
}

describe('passkeys (T1.2)', () => {
  it('enrolls a passkey after an email login, then signs in with it on a fresh device', async () => {
    const { body: emailLogin, authCookies } = await loginWithEmail('passkey@test.dev');
    const authenticator = new SoftwareAuthenticator('localhost', EMBED_ORIGIN);

    // Enrollment, carried by the Better Auth session in the bridge header.
    const registerOptions = await getJson(
      '/v1/auth/passkey/generate-register-options',
      authCookies,
    );
    expect(registerOptions.status, await registerOptions.clone().text()).toBe(200);
    const { challenge: registerChallenge, rp } = await registerOptions.json<{
      challenge: string;
      rp: { id: string };
    }>();
    expect(rp.id).toBe('localhost');

    const registerCookies = registerOptions.headers.get(AUTH_COOKIES_HEADER) ?? '';
    const registration = await postJson(
      '/v1/auth/passkey/verify-registration',
      { response: authenticator.register(registerChallenge), name: 'Test key' },
      { [AUTH_COOKIES_HEADER]: registerCookies },
    );
    expect(registration.status, await registration.clone().text()).toBe(200);

    // Fresh device: no session at all, only the challenge the server hands out.
    const authOptions = await getJson('/v1/auth/passkey/generate-authenticate-options', '');
    expect(authOptions.status, await authOptions.clone().text()).toBe(200);
    const { challenge: authChallenge } = await authOptions.json<{ challenge: string }>();

    const signIn = await postJson(
      '/v1/auth/passkey/verify-authentication',
      { response: authenticator.authenticate(authChallenge) },
      { [AUTH_COOKIES_HEADER]: authOptions.headers.get(AUTH_COOKIES_HEADER) ?? '' },
    );
    expect(signIn.status, await signIn.clone().text()).toBe(200);
    const body = AuthResponse.parse(await signIn.json());

    expect(body.isNewUser).toBe(false);
    expect(body.user.id).toBe(emailLogin.user.id);
    expect(body.user.identities.map((identity) => identity.type).sort()).toEqual([
      'email',
      'passkey',
    ]);
    expect(body.user.identities.find((identity) => identity.type === 'passkey')?.identifier).toBe(
      authenticator.id,
    );
  });

  it('refuses an assertion signed for another challenge', async () => {
    const { authCookies } = await loginWithEmail('passkey-replay@test.dev');
    const authenticator = new SoftwareAuthenticator('localhost', EMBED_ORIGIN);
    const options = await getJson('/v1/auth/passkey/generate-register-options', authCookies);
    const { challenge } = await options.json<{ challenge: string }>();
    await postJson(
      '/v1/auth/passkey/verify-registration',
      { response: authenticator.register(challenge) },
      { [AUTH_COOKIES_HEADER]: options.headers.get(AUTH_COOKIES_HEADER) ?? '' },
    );

    const authOptions = await getJson('/v1/auth/passkey/generate-authenticate-options', '');
    const signIn = await postJson(
      '/v1/auth/passkey/verify-authentication',
      { response: authenticator.authenticate('bm90LXRoZS1yaWdodC1jaGFsbGVuZ2U') },
      { [AUTH_COOKIES_HEADER]: authOptions.headers.get(AUTH_COOKIES_HEADER) ?? '' },
    );
    expect(signIn.status).toBeGreaterThanOrEqual(400);
  });

  it('refuses a registration without a session', async () => {
    const res = await getJson('/v1/auth/passkey/generate-register-options', '');
    expect(res.status).toBe(401);
  });
});
