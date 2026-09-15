import { ApiErrorBody, PublicAppConfig } from '@pocketkey/types';
import { beforeAll, describe, expect, it } from 'vitest';
import { isOriginAllowed } from '../src/middleware/app.js';
import { request, SEED, seedDb, withApp } from './helpers.js';

beforeAll(async () => {
  await seedDb();
});

describe('requireApp middleware', () => {
  it('rejects a missing header with app_id_missing', async () => {
    const res = await request(`/v1/apps/${SEED.app.publicId}/config`);
    expect(res.status).toBe(400);
    expect(ApiErrorBody.parse(await res.json()).error.code).toBe('app_id_missing');
  });

  it('rejects a malformed header with app_id_invalid', async () => {
    const res = await request(`/v1/apps/${SEED.app.publicId}/config`, {
      headers: { 'X-Pocketkey-App-Id': 'pk_app_nope' },
    });
    expect(res.status).toBe(401);
    expect(ApiErrorBody.parse(await res.json()).error.code).toBe('app_id_invalid');
  });

  it('rejects an unknown app id with app_id_invalid', async () => {
    const res = await request(`/v1/apps/${SEED.app.publicId}/config`, {
      headers: { 'X-Pocketkey-App-Id': 'pk_app_zzzzzzzzzzzzzzzzzzzzzzzz' },
    });
    expect(res.status).toBe(401);
    expect(ApiErrorBody.parse(await res.json()).error.code).toBe('app_id_invalid');
  });

  it('rejects a browser origin that is not allowlisted', async () => {
    const res = await request(`/v1/apps/${SEED.app.publicId}/config`, {
      headers: withApp({ Origin: 'https://evil.example' }),
    });
    expect(res.status).toBe(403);
    expect(ApiErrorBody.parse(await res.json()).error.code).toBe('origin_not_allowed');
  });

  it('serves the public config to an allowed origin', async () => {
    const res = await request(`/v1/apps/${SEED.app.publicId}/config`, {
      headers: withApp({ Origin: 'http://localhost:3000' }),
    });
    expect(res.status).toBe(200);
    const body = PublicAppConfig.parse(await res.json());
    expect(body.appId).toBe(SEED.app.publicId);
    expect(body.name).toBe('Playground');
    expect(body.loginMethods).toContain('email');
    expect(body.chains.evm).toEqual([8453]);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
  });

  it('serves the public config to a server call without Origin', async () => {
    const res = await request(`/v1/apps/${SEED.app.publicId}/config`, { headers: withApp() });
    expect(res.status).toBe(200);
  });

  it('refuses a path app id that differs from the header', async () => {
    const res = await request('/v1/apps/pk_app_zzzzzzzzzzzzzzzzzzzzzzzz/config', {
      headers: withApp(),
    });
    expect(res.status).toBe(403);
  });

  it('answers CORS preflight', async () => {
    const res = await request(`/v1/apps/${SEED.app.publicId}/config`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3000',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'x-pocketkey-app-id',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('X-Pocketkey-App-Id');
  });
});

describe('isOriginAllowed', () => {
  it('normalizes and compares origins strictly', () => {
    const allowed = ['https://app.example.com'];
    expect(isOriginAllowed('https://app.example.com', allowed)).toBe(true);
    expect(isOriginAllowed('https://app.example.com/', allowed)).toBe(true);
    expect(isOriginAllowed('http://app.example.com', allowed)).toBe(false);
    expect(isOriginAllowed('https://sub.app.example.com', allowed)).toBe(false);
    expect(isOriginAllowed('not a url', allowed)).toBe(false);
    expect(isOriginAllowed('https://app.example.com', [])).toBe(false);
  });
});
