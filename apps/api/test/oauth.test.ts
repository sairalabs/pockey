import { authChallenges } from '@pocketkey/db';
import { AuthResponse } from '@pocketkey/types';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/lib/crypto.js';
import { db, loginWithEmail, postJson, request, SEED, seedDb } from './helpers.js';

beforeAll(async () => {
  await seedDb();
});

describe('OAuth popup flow', () => {
  it('starts Google sign-in with our callback and remembers which app owns the state', async () => {
    const res = await request(`/v1/auth/oauth/${SEED.app.publicId}/google/start`);
    expect(res.status, await res.clone().text()).toBe(302);

    const location = new URL(res.headers.get('Location') ?? '');
    expect(location.hostname).toBe('accounts.google.com');
    expect(location.searchParams.get('redirect_uri')).toBe(
      'http://localhost:8787/v1/auth/callback/google',
    );
    expect(location.searchParams.get('client_id')).toBe(
      'test-google-client-id.apps.googleusercontent.com',
    );

    const state = location.searchParams.get('state');
    expect(state).toBeTruthy();
    const challenge = await db().query.authChallenges.findFirst({
      where: eq(authChallenges.id, await sha256Hex(state ?? '')),
    });
    expect(challenge?.purpose).toBe('oauth_state');
    expect(challenge?.appId).toBe(SEED.app.id);
    // The popup is first party on the API origin, so real cookies are fine there.
    expect(res.headers.getSetCookie().length).toBeGreaterThan(0);
  });

  it('refuses a provider that is not configured on the server', async () => {
    const res = await request(`/v1/auth/oauth/${SEED.app.publicId}/apple/start`);
    expect(res.status).toBe(400);
  });

  it('refuses a callback whose state it never issued', async () => {
    const res = await request('/v1/auth/callback/google?state=forged&code=x');
    expect(res.status).toBe(400);
  });

  it('reports a missing session back to the iframe without leaking anything', async () => {
    const res = await request(`/v1/auth/oauth/${SEED.app.publicId}/complete`);
    expect(res.status).toBe(401);
    const html = await res.text();
    expect(html).toContain('"error":"no_session"');
    expect(html).toContain('"http://localhost:5174"');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('hands a single-use code to the iframe, which exchanges it for tokens', async () => {
    // A Better Auth session, as the provider callback would leave in the popup.
    const { body: first, authCookies } = await loginWithEmail('popup@test.dev');

    const complete = await request(`/v1/auth/oauth/${SEED.app.publicId}/complete`, {
      headers: { Cookie: authCookies },
    });
    expect(complete.status).toBe(200);
    const code = /"code":"([A-Za-z0-9_-]+)"/.exec(await complete.text())?.[1];
    expect(code).toBeTruthy();

    const exchange = await postJson('/v1/auth/oauth/exchange', { code });
    expect(exchange.status, await exchange.clone().text()).toBe(200);
    const body = AuthResponse.parse(await exchange.json());
    expect(body.user.id).toBe(first.user.id);

    const reuse = await postJson('/v1/auth/oauth/exchange', { code });
    expect(reuse.status).toBe(401);
  });
});
