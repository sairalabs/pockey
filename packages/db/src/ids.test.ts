import { AppId, PublicAppId, SecretApiKey } from '@pocketkey/types';
import { describe, expect, it } from 'vitest';
import { apiKeyPrefix, sha256Hex } from './hash.js';
import { newId, newPublicAppId, newSecretApiKey } from './ids.js';

describe('ids', () => {
  it('generates ids that satisfy the shared schemas', () => {
    expect(AppId.safeParse(newId('app')).success).toBe(true);
    expect(PublicAppId.safeParse(newPublicAppId()).success).toBe(true);
    expect(SecretApiKey.safeParse(newSecretApiKey()).success).toBe(true);
  });

  it('never repeats', () => {
    const set = new Set(Array.from({ length: 1000 }, () => newId('usr')));
    expect(set.size).toBe(1000);
  });
});

describe('api key hashing', () => {
  it('hashes deterministically and keeps a 12 char prefix', async () => {
    const secret = newSecretApiKey();
    expect(await sha256Hex(secret)).toBe(await sha256Hex(secret));
    expect(await sha256Hex(secret)).toHaveLength(64);
    expect(apiKeyPrefix(secret)).toBe(secret.slice(0, 12));
    expect(apiKeyPrefix(secret).startsWith('pk_sk_')).toBe(true);
  });
});
