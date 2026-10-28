import { baUser, developers, endUserIdentities } from '@pockey/db';
import { AdminSession, ApiErrorBody, AuthProviders } from '@pockey/types';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  adminRequest,
  db,
  DASHBOARD_ORIGIN,
  cookiesOf,
  EMBED_ORIGIN,
  loginAsDeveloper,
  loginWithEmail,
  mailer,
  otpFrom,
  request,
  seedDb,
  SEED,
  withApp,
} from './helpers.js';

beforeAll(async () => {
  await seedDb();
});

/** One entry per admin route, used by the unauthenticated sweep. */
const ADMIN_ROUTES: [string, string][] = [
  ['GET', '/admin/session'],
  ['GET', '/admin/apps'],
  ['POST', '/admin/apps'],
  ['GET', `/admin/apps/${SEED.app.id}`],
  ['PATCH', `/admin/apps/${SEED.app.id}`],
  ['PUT', `/admin/apps/${SEED.app.id}/config`],
  ['DELETE', `/admin/apps/${SEED.app.id}`],
  ['GET', `/admin/apps/${SEED.app.id}/api-keys`],
  ['POST', `/admin/apps/${SEED.app.id}/api-keys`],
  ['DELETE', `/admin/apps/${SEED.app.id}/api-keys/key_seed00000000000000000001`],
  ['GET', `/admin/apps/${SEED.app.id}/usage`],
  ['GET', `/admin/apps/${SEED.app.id}/users`],
  ['GET', `/admin/apps/${SEED.app.id}/sponsoring`],
  ['POST', `/admin/apps/${SEED.app.id}/sponsoring/checkout`],
  ['GET', '/admin/billing'],
  ['GET', '/admin/billing/portal'],
];

describe('developer authentication', () => {
  it('signs in with an email OTP and reuses the session cookie', async () => {
    const email = 'ada.dev@test.dev';
    const cookie = await loginAsDeveloper(email);
    expect(mailer().lastTo(email)?.text).toContain('Pockey');

    const first = await adminRequest('/admin/session', cookie);
    expect(first.status, await first.clone().text()).toBe(200);
    const session = AdminSession.parse(await first.json());
    expect(session.developer.email).toBe(email);
    expect(session.developer.billingReady).toBe(false);
    expect(session.developer.id.startsWith('dev_')).toBe(true);

    // The same cookie keeps working, and the developer row is created once.
    const second = await adminRequest('/admin/apps', cookie);
    expect(second.status).toBe(200);
    const rows = await db().select().from(developers).where(eq(developers.email, email));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.authUserId).not.toBeNull();
  });

  it('links an existing developer row instead of creating a second one', async () => {
    const cookie = await loginAsDeveloper(SEED.developer.email);
    const res = await adminRequest('/admin/session', cookie);
    const session = AdminSession.parse(await res.json());
    expect(session.developer.id).toBe(SEED.developer.id);
    expect(session.developer.name).toBe(SEED.developer.name);

    const rows = await db()
      .select()
      .from(developers)
      .where(eq(developers.email, SEED.developer.email));
    expect(rows).toHaveLength(1);
  });

  it('keeps the developer pool separate from the end user pools', async () => {
    const email = 'shared.pool@test.dev';
    const cookie = await loginAsDeveloper(email);
    const { body } = await loginWithEmail(email);

    // Better Auth only holds developers now; end users live in their app.
    const rows = await db().select().from(baUser).where(eq(baUser.email, email));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.appId).toBeNull();
    const identities = await db()
      .select()
      .from(endUserIdentities)
      .where(and(eq(endUserIdentities.type, 'email'), eq(endUserIdentities.identifier, email)));
    expect(identities.map((row) => [row.appId, row.endUserId])).toEqual([
      [SEED.app.id, body.user.id],
    ]);

    // Neither credential opens the other side.
    const endUserOnAdmin = await request('/admin/session', {
      headers: { Origin: DASHBOARD_ORIGIN, Authorization: `Bearer ${body.accessToken}` },
    });
    expect(endUserOnAdmin.status).toBe(401);
    const developerOnApi = await request('/v1/me', {
      headers: withApp({ Origin: EMBED_ORIGIN, Cookie: cookie }),
    });
    expect(developerOnApi.status).toBe(401);
  });

  it('signs out and stops accepting the cookie', async () => {
    const cookie = await loginAsDeveloper('bye@test.dev');
    const out = await adminRequest('/admin/auth/sign-out', cookie, { method: 'POST', body: {} });
    expect(out.status).toBe(200);

    const after = await adminRequest('/admin/session', cookie);
    expect(after.status).toBe(401);
    expect(ApiErrorBody.parse(await after.json()).error.code).toBe('unauthorized');
  });

  it('answers 401 on every admin route without a session', async () => {
    for (const [method, path] of ADMIN_ROUTES) {
      const res = await adminRequest(path, '', { method, body: method === 'GET' ? undefined : {} });
      expect(res.status, `${method} ${path}`).toBe(401);
      expect(ApiErrorBody.parse(await res.json()).error.code).toBe('unauthorized');
    }
  });

  it('keeps every Better Auth endpoint outside the allowlist closed', async () => {
    const closed = [
      '/admin/auth/sign-up/email',
      '/admin/auth/sign-in/email',
      '/admin/auth/update-user',
      '/admin/auth/delete-user',
      '/admin/auth/list-sessions',
    ];
    for (const path of closed) {
      const res = await adminRequest(path, '', { method: 'POST', body: {} });
      expect(res.status, path).toBe(404);
      expect(ApiErrorBody.parse(await res.json()).error.code).toBe('not_found');
    }
  });

  it('only allows the sign-in OTP type', async () => {
    const res = await adminRequest('/admin/auth/email-otp/send-verification-otp', '', {
      method: 'POST',
      body: { email: 'nope@test.dev', type: 'forget-password' },
    });
    expect(res.status).toBe(400);
    expect(ApiErrorBody.parse(await res.json()).error.code).toBe('validation_failed');
  });

  it('refuses a code issued for another email', async () => {
    const email = 'mismatch@test.dev';
    await adminRequest('/admin/auth/email-otp/send-verification-otp', '', {
      method: 'POST',
      body: { email, type: 'sign-in' },
    });
    const res = await adminRequest('/admin/auth/sign-in/email-otp', '', {
      method: 'POST',
      body: { email: 'other@test.dev', otp: otpFrom(email) },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(ApiErrorBody.safeParse(await res.json()).success).toBe(true);
  });

  it('starts a GitHub sign-in when it is configured', async () => {
    const res = await adminRequest('/admin/auth/sign-in/social', '', {
      method: 'POST',
      body: { provider: 'github', callbackURL: `${DASHBOARD_ORIGIN}/apps` },
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = await res.json<{ url?: string }>();
    expect(body.url ?? '').toContain('github.com/login/oauth/authorize');
  });

  it('answers the dashboard preflight with credentials and echoes no other origin', async () => {
    const preflight = await request('/admin/session', {
      method: 'OPTIONS',
      headers: {
        Origin: DASHBOARD_ORIGIN,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe(DASHBOARD_ORIGIN);
    expect(preflight.headers.get('Access-Control-Allow-Credentials')).toBe('true');

    const foreign = await request('/admin/session', {
      headers: { Origin: 'https://evil.example' },
    });
    expect(foreign.headers.get('Access-Control-Allow-Origin')).toBe(DASHBOARD_ORIGIN);
  });

  it('sets a session cookie that is not shared with the end user instance', async () => {
    const email = 'cookie.name@test.dev';
    const send = await adminRequest('/admin/auth/email-otp/send-verification-otp', '', {
      method: 'POST',
      body: { email, type: 'sign-in' },
    });
    expect(send.status).toBe(200);
    const signIn = await adminRequest('/admin/auth/sign-in/email-otp', '', {
      method: 'POST',
      body: { email, otp: otpFrom(email) },
    });
    expect(cookiesOf(signIn)).toContain('pockey_dev.session_token=');
  });
});

describe('GET /admin/auth/providers', () => {
  it('tells the dashboard which developer logins this server can serve', async () => {
    const res = await adminRequest('/admin/auth/providers', '');
    expect(res.status).toBe(200);
    // Email always works; GitHub needs both secrets, which the test bindings do set.
    expect(AuthProviders.parse(await res.json())).toEqual({ email: true, github: true });
  });
});
