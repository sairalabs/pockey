import { AppConfig } from '@pocketkey/types';
import type { Db } from './client.js';
import { apiKeyPrefix, sha256Hex } from './hash.js';
import { apps, apiKeys, developers, sponsorBalances } from './schema.js';

/**
 * Deterministic local fixture. Same values in `seed/local.sql` so that
 * `wrangler d1 execute --local --file` and the test suite agree.
 */
export const SEED = {
  developer: {
    id: 'dev_seed00000000000000000001',
    email: 'dev@pocketkey.local',
    name: 'Local Developer',
  },
  app: {
    id: 'app_seed00000000000000000001',
    publicId: 'pk_app_seed00000000000000000001',
    name: 'Playground',
    slug: 'playground',
    allowedOrigins: ['http://localhost:3000', 'http://localhost:3800'],
  },
  apiKey: {
    id: 'key_seed00000000000000000001',
    secret: 'pk_sk_seed00000000000000000001',
  },
} as const;

export async function seed(db: Db): Promise<void> {
  await db
    .insert(developers)
    .values({
      id: SEED.developer.id,
      email: SEED.developer.email,
      name: SEED.developer.name,
    })
    .onConflictDoNothing();

  await db
    .insert(apps)
    .values({
      id: SEED.app.id,
      publicId: SEED.app.publicId,
      developerId: SEED.developer.id,
      name: SEED.app.name,
      slug: SEED.app.slug,
      allowedOrigins: [...SEED.app.allowedOrigins],
      config: AppConfig.parse({}),
    })
    .onConflictDoNothing();

  await db
    .insert(apiKeys)
    .values({
      id: SEED.apiKey.id,
      appId: SEED.app.id,
      hash: await sha256Hex(SEED.apiKey.secret),
      prefix: apiKeyPrefix(SEED.apiKey.secret),
      name: 'Local server key',
    })
    .onConflictDoNothing();

  await db
    .insert(sponsorBalances)
    .values({ appId: SEED.app.id, balanceCents: 0 })
    .onConflictDoNothing();
}
