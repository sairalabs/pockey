import { apiKeys, sponsorBalances } from '@pockey/db';
import {
  AdminApp,
  AdminAppList,
  ApiErrorBody,
  ApiKeyList,
  CreateApiKeyOutput,
  PublicAppConfig,
  ServerUserList,
} from '@pockey/types';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  adminRequest,
  createAdminApp,
  db,
  loginAsDeveloper,
  request,
  seedDb,
  SEED,
} from './helpers.js';

let owner = '';

beforeAll(async () => {
  await seedDb();
  owner = await loginAsDeveloper('owner@test.dev');
});

function publicConfig(publicId: string): Promise<Response> {
  return request(`/v1/apps/${publicId}/config`, {
    headers: { 'X-Pockey-App-Id': publicId },
  });
}

describe('apps CRUD', () => {
  it('creates an app with a derived slug, defaults and a sponsor balance row', async () => {
    const created = await createAdminApp(owner, { name: 'My Great App' });
    expect(created.app.slug).toBe('my-great-app');
    expect(created.app.publicId.startsWith('pk_app_')).toBe(true);
    expect(created.app.config.loginMethods).toEqual(['email', 'google', 'passkey']);
    expect(created.app.config.chains.evm).toEqual([8453]);
    expect(created.usage.activeUsers).toBe(0);
    expect(created.apiKeyCount).toBe(0);
    expect(created.endUserCount).toBe(0);
    expect(created.sponsorBalanceCents).toBe(0);

    const balance = await db()
      .select()
      .from(sponsorBalances)
      .where(eq(sponsorBalances.appId, created.app.id));
    expect(balance).toHaveLength(1);

    // Usable by the SDK straight away.
    const config = await publicConfig(created.app.publicId);
    expect(config.status).toBe(200);
    expect(PublicAppConfig.parse(await config.json()).name).toBe('My Great App');
  });

  it('adds a numeric suffix when the derived slug is taken', async () => {
    const first = await createAdminApp(owner, { name: 'Twin App' });
    const second = await createAdminApp(owner, { name: 'Twin App' });
    const third = await createAdminApp(owner, { name: 'Twin  app!' });
    expect(first.app.slug).toBe('twin-app');
    expect(second.app.slug).toBe('twin-app-2');
    expect(third.app.slug).toBe('twin-app-3');
  });

  it('refuses an explicit slug already used by another app of the developer', async () => {
    await createAdminApp(owner, { name: 'Taken', slug: 'taken-slug' });
    const res = await adminRequest('/admin/apps', owner, {
      method: 'POST',
      body: { name: 'Other', slug: 'taken-slug' },
    });
    expect(res.status).toBe(409);
    expect(ApiErrorBody.parse(await res.json()).error.code).toBe('conflict');
  });

  it('lists the apps of the developer, newest first', async () => {
    const created = await createAdminApp(owner, { name: 'Newest App' });
    const res = await adminRequest('/admin/apps', owner);
    expect(res.status).toBe(200);
    const list = AdminAppList.parse(await res.json());
    expect(list.apps[0]?.app.id).toBe(created.app.id);
    // Never another developer's app.
    expect(list.apps.some((entry) => entry.app.id === SEED.app.id)).toBe(false);
  });

  it('patches name, origins and part of the config', async () => {
    const created = await createAdminApp(owner, { name: 'Patchable' });
    const res = await adminRequest(`/admin/apps/${created.app.id}`, owner, {
      method: 'PATCH',
      body: {
        name: 'Patched',
        allowedOrigins: ['https://patched.example'],
        config: { loginMethods: ['email', 'wallet'] },
      },
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const patched = AdminApp.parse(await res.json());
    expect(patched.app.name).toBe('Patched');
    expect(patched.app.allowedOrigins).toEqual(['https://patched.example']);
    expect(patched.app.config.loginMethods).toEqual(['email', 'wallet']);
    // Untouched parts of the config survive the patch.
    expect(patched.app.config.chains.evm).toEqual([8453]);
  });

  it('replaces the config and invalidates the edge cache immediately', async () => {
    const created = await createAdminApp(owner, { name: 'Cached App' });

    const primed = await publicConfig(created.app.publicId);
    expect(primed.status).toBe(200);
    const cached = await publicConfig(created.app.publicId);
    expect(cached.headers.get('X-Pockey-App-Cache')).toBe('HIT');

    const res = await adminRequest(`/admin/apps/${created.app.id}/config`, owner, {
      method: 'PUT',
      body: {
        config: {
          loginMethods: ['email'],
          chains: { evm: [84532], solana: ['devnet'] },
          appearance: { theme: 'dark', accent: '#00ff00' },
          embeddedWallets: { createOnLogin: 'evm' },
          gasSponsoring: { evm: true, solana: false, solanaDailyCapLamports: '1000' },
        },
      },
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(AdminApp.parse(await res.json()).app.config.appearance.accent).toBe('#00ff00');

    const after = await publicConfig(created.app.publicId);
    const fresh = PublicAppConfig.parse(await after.json());
    expect(after.headers.get('X-Pockey-App-Cache')).toBe('MISS');
    expect(fresh.loginMethods).toEqual(['email']);
    expect(fresh.appearance.accent).toBe('#00ff00');
    expect(fresh.embeddedWallets.createOnLogin).toBe('evm');
  });

  it('deletes an app and everything hanging off it', async () => {
    const created = await createAdminApp(owner, { name: 'Doomed App' });
    const key = await adminRequest(`/admin/apps/${created.app.id}/api-keys`, owner, {
      method: 'POST',
      body: {},
    });
    expect(key.status).toBe(201);

    const res = await adminRequest(`/admin/apps/${created.app.id}`, owner, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const gone = await adminRequest(`/admin/apps/${created.app.id}`, owner);
    expect(gone.status).toBe(404);
    const keys = await db().select().from(apiKeys).where(eq(apiKeys.appId, created.app.id));
    expect(keys).toHaveLength(0);
    expect(await publicConfig(created.app.publicId).then((r) => r.status)).toBe(401);
  });
});

describe('API keys', () => {
  it('returns the secret once, then only its prefix, and revokes it', async () => {
    const created = await createAdminApp(owner, { name: 'Keyed App' });
    const res = await adminRequest(`/admin/apps/${created.app.id}/api-keys`, owner, {
      method: 'POST',
      body: { name: 'CI' },
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const { key, secret } = CreateApiKeyOutput.parse(await res.json());
    expect(secret.startsWith('pk_sk_')).toBe(true);
    expect(key.prefix).toBe(secret.slice(0, 12));
    expect(key.revokedAt).toBeNull();

    const serverHeaders = {
      'X-Pockey-App-Id': created.app.publicId,
      Authorization: `Bearer ${secret}`,
    };
    const users = await request('/v1/server/users', { headers: serverHeaders });
    expect(users.status, await users.clone().text()).toBe(200);
    expect(ServerUserList.parse(await users.json()).users).toEqual([]);

    const listed = await adminRequest(`/admin/apps/${created.app.id}/api-keys`, owner);
    const list = ApiKeyList.parse(await listed.json());
    expect(list.keys).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(secret);
    expect(list.keys[0]?.name).toBe('CI');
    expect(list.keys[0]?.scopes).toEqual(['server']);

    const revoke = await adminRequest(`/admin/apps/${created.app.id}/api-keys/${key.id}`, owner, {
      method: 'DELETE',
    });
    expect(revoke.status).toBe(200);
    // Revoking twice is not an error.
    const again = await adminRequest(`/admin/apps/${created.app.id}/api-keys/${key.id}`, owner, {
      method: 'DELETE',
    });
    expect(again.status).toBe(200);

    const refused = await request('/v1/server/users', { headers: serverHeaders });
    expect(refused.status).toBe(401);
    expect(ApiErrorBody.parse(await refused.json()).error.code).toBe('api_key_invalid');

    const afterRevoke = ApiKeyList.parse(
      await adminRequest(`/admin/apps/${created.app.id}/api-keys`, owner).then((r) => r.json()),
    );
    expect(afterRevoke.keys[0]?.revokedAt).not.toBeNull();
  });

  it('404s on an api key of another app', async () => {
    const mine = await createAdminApp(owner, { name: 'Mine' });
    const res = await adminRequest(`/admin/apps/${mine.app.id}/api-keys/${SEED.apiKey.id}`, owner, {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
  });
});

describe('ownership', () => {
  it('404s on every route of an app owned by another developer', async () => {
    const routes: [string, string, unknown][] = [
      ['GET', '', undefined],
      ['PATCH', '', { name: 'Stolen' }],
      ['PUT', '/config', { config: { loginMethods: ['email'] } }],
      ['DELETE', '', undefined],
      ['GET', '/api-keys', undefined],
      ['POST', '/api-keys', {}],
      ['GET', '/usage', undefined],
      ['GET', '/users', undefined],
      ['GET', '/sponsoring', undefined],
      [
        'POST',
        '/sponsoring/checkout',
        { amountCents: 1000, successUrl: 'https://a.example', cancelUrl: 'https://b.example' },
      ],
    ];
    for (const [method, suffix, body] of routes) {
      const res = await adminRequest(`/admin/apps/${SEED.app.id}${suffix}`, owner, {
        method,
        ...(body === undefined ? {} : { body }),
      });
      expect(res.status, `${method} ${suffix}`).toBe(404);
      expect(ApiErrorBody.parse(await res.json()).error.code).toBe('not_found');
    }
  });

  it('404s on a malformed app id', async () => {
    const res = await adminRequest('/admin/apps/not-an-id', owner);
    expect(res.status).toBe(404);
  });
});
