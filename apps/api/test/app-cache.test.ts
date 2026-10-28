import { PublicAppConfig } from '@pockey/types';
import { beforeAll, describe, expect, it } from 'vitest';
import { request, SEED, seedDb, updateSeedConfig, withApp } from './helpers.js';

beforeAll(async () => {
  await seedDb();
});

const configPath = `/v1/apps/${SEED.app.publicId}/config`;

describe('public config edge cache', () => {
  it('serves the app from the edge cache on the second request', async () => {
    const first = await request(configPath, { headers: withApp() });
    const second = await request(configPath, { headers: withApp() });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.headers.get('X-Pockey-App-Cache')).toBe('HIT');
    expect(second.headers.get('Cache-Control')).toBe('public, max-age=60');
    expect(second.headers.get('Vary')).toContain('Origin');
    expect(await second.json()).toEqual(await first.json());
  });

  it('reflects a config change as soon as the app cache is invalidated', async () => {
    await request(configPath, { headers: withApp() });
    await updateSeedConfig({ appearance: { theme: 'dark', accent: '#0052ff' } });
    const res = await request(configPath, { headers: withApp() });
    expect(res.headers.get('X-Pockey-App-Cache')).toBe('MISS');
    expect(PublicAppConfig.parse(await res.json()).appearance.accent).toBe('#0052ff');
  });

  it('still enforces the origin allowlist on cached apps', async () => {
    await request(configPath, { headers: withApp() });
    const res = await request(configPath, { headers: withApp({ Origin: 'https://evil.example' }) });
    expect(res.status).toBe(403);
  });

  it('accepts the embed iframe origin for every app', async () => {
    const res = await request(configPath, {
      headers: withApp({ Origin: 'http://localhost:5174' }),
    });
    expect(res.status).toBe(200);
  });
});
