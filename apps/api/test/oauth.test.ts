import { authChallenges } from '@pockey/db';
import { generateSessionKey, oidcNonce } from '@pockey/key-provider/client';
import { AuthResponse } from '@pockey/types';
import { base64urlnopad } from '@scure/base';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getEmulator } from '../src/lib/key-provider.js';
import { sha256Hex } from '../src/lib/crypto.js';
import { setOidcFetchForTests } from '../src/routes/auth.js';
import { db, postJson, request, SEED, seedDb } from './helpers.js';

const CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com';

/** What the fake Google token endpoint puts in the next ID token, and what it received. */
let nextClaims: Record<string, unknown> = {};
let lastTokenRequest: URLSearchParams | null = null;

const b64json = (value: unknown) =>
  base64urlnopad.encode(new TextEncoder().encode(JSON.stringify(value)));

/** Unsigned ID token: the token endpoint answer is trusted over TLS, the emulator reads claims. */
function idToken(claims: Record<string, unknown>): string {
  return `${b64json({ alg: 'RS256', typ: 'JWT' })}.${b64json(claims)}.sig`;
}

beforeAll(async () => {
  await seedDb();
  setOidcFetchForTests(async (_url, init) => {
    lastTokenRequest = new URLSearchParams(typeof init?.body === 'string' ? init.body : '');
    return Response.json({ id_token: idToken(nextClaims) });
  });
});

afterAll(() => {
  setOidcFetchForTests(null);
});

async function start(publicKey: string, provider = 'google') {
  return request(`/v1/auth/oauth/${SEED.app.publicId}/${provider}/start?publicKey=${publicKey}`);
}

/** Start, provider redirect back, callback: returns the exchange code posted to the iframe. */
async function popup(publicKey: string, subject: string, nonce = oidcNonce(publicKey)) {
  const location = new URL((await start(publicKey)).headers.get('Location') ?? '');
  nextClaims = {
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: subject,
    email: `${subject}@gmail.test`,
    email_verified: true,
    nonce,
  };
  const state = location.searchParams.get('state') ?? '';
  const callback = await request(
    `/v1/auth/callback/google?state=${encodeURIComponent(state)}&code=provider-code`,
  );
  const html = await callback.text();
  return {
    callback,
    html,
    state,
    code: /"code":"([A-Za-z0-9_-]+)"/.exec(html)?.[1] ?? '',
  };
}

describe('OAuth popup flow (non-custodial)', () => {
  it('starts Google sign-in with a nonce committing to the session key', async () => {
    const key = await generateSessionKey();
    const res = await start(key.publicKey);
    expect(res.status, await res.clone().text()).toBe(302);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    // No cookie: the state lives server side, keyed by its hash.
    expect(res.headers.getSetCookie()).toEqual([]);

    const location = new URL(res.headers.get('Location') ?? '');
    expect(location.hostname).toBe('accounts.google.com');
    expect(location.searchParams.get('redirect_uri')).toBe(
      'http://localhost:8787/v1/auth/callback/google',
    );
    expect(location.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(location.searchParams.get('nonce')).toBe(await sha256Hex(key.publicKey));
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');

    const state = location.searchParams.get('state');
    expect(state).toBeTruthy();
    const challenge = await db().query.authChallenges.findFirst({
      where: eq(authChallenges.id, await sha256Hex(state ?? '')),
    });
    expect(challenge?.purpose).toBe('oauth_state');
    expect(challenge?.appId).toBe(SEED.app.id);
  });

  it('refuses a start without a session public key', async () => {
    const res = await request(`/v1/auth/oauth/${SEED.app.publicId}/google/start`);
    expect(res.status).toBe(400);
  });

  it('refuses a provider that is not configured on the server', async () => {
    const key = await generateSessionKey();
    const res = await start(key.publicKey, 'apple');
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('not configured');
  });

  it('refuses a callback whose state it never issued', async () => {
    const res = await request('/v1/auth/callback/google?state=forged&code=x');
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('"error":"expired"');
  });

  it('exchanges the code at the provider, then hands a single-use code to the iframe', async () => {
    const key = await generateSessionKey();
    const { callback, html, code } = await popup(key.publicKey, 'google-sub-1');
    expect(callback.status).toBe(200);
    expect(callback.headers.get('Cache-Control')).toBe('no-store');
    expect(html).toContain('"http://localhost:5174"');
    expect(code).toBeTruthy();
    expect(lastTokenRequest?.get('code')).toBe('provider-code');
    expect(lastTokenRequest?.get('code_verifier')).toBeTruthy();

    const exchange = await postJson('/v1/auth/oauth/exchange', { code, publicKey: key.publicKey });
    expect(exchange.status, await exchange.clone().text()).toBe(200);
    const body = AuthResponse.parse(await exchange.json());
    expect(body.isNewUser).toBe(true);
    expect(body.user.identities).toEqual([
      expect.objectContaining({ type: 'google', identifier: 'google-sub-1' }),
    ]);
    // Only the iframe key was registered, with the Google identity as root credential.
    expect(getEmulator().inspect(body.keySession.organizationId).rootUser.apiKeys).toEqual([
      key.publicKey,
    ]);

    const reuse = await postJson('/v1/auth/oauth/exchange', { code, publicKey: key.publicKey });
    expect(reuse.status).toBe(401);
  });

  it('reuses the end user on the next Google login', async () => {
    const firstKey = await generateSessionKey();
    const first = await popup(firstKey.publicKey, 'google-sub-2');
    const one = await postJson('/v1/auth/oauth/exchange', {
      code: first.code,
      publicKey: firstKey.publicKey,
    });
    const firstBody = AuthResponse.parse(await one.json());

    const secondKey = await generateSessionKey();
    const second = await popup(secondKey.publicKey, 'google-sub-2');
    const two = await postJson('/v1/auth/oauth/exchange', {
      code: second.code,
      publicKey: secondKey.publicKey,
    });
    expect(two.status, await two.clone().text()).toBe(200);
    const secondBody = AuthResponse.parse(await two.json());
    expect(secondBody.isNewUser).toBe(false);
    expect(secondBody.user.id).toBe(firstBody.user.id);
    expect(secondBody.keySession.organizationId).toBe(firstBody.keySession.organizationId);
  });

  it('refuses an exchange with another session key, and burns the code', async () => {
    const key = await generateSessionKey();
    const { code } = await popup(key.publicKey, 'google-sub-3');
    const intruder = await generateSessionKey();

    const wrong = await postJson('/v1/auth/oauth/exchange', {
      code,
      publicKey: intruder.publicKey,
    });
    expect(wrong.status).toBe(401);

    const late = await postJson('/v1/auth/oauth/exchange', { code, publicKey: key.publicKey });
    expect(late.status).toBe(401);
  });

  it('refuses an ID token whose nonce commits to another key', async () => {
    const key = await generateSessionKey();
    const other = await generateSessionKey();
    const { callback, html } = await popup(
      key.publicKey,
      'google-sub-4',
      oidcNonce(other.publicKey),
    );
    expect(callback.status).toBe(400);
    expect(html).toContain('"error":"provider_refused"');
  });

  it('makes the state single use', async () => {
    const key = await generateSessionKey();
    const { state, code } = await popup(key.publicKey, 'google-sub-5');
    expect(code).toBeTruthy();
    const again = await request(
      `/v1/auth/callback/google?state=${encodeURIComponent(state)}&code=provider-code`,
    );
    expect(again.status).toBe(400);
  });
});
