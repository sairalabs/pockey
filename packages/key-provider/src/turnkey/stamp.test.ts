import { describe, expect, it } from 'vitest';
import {
  compressP256PublicKey,
  createApiKeyStamper,
  createCryptoKeyStamper,
  generateApiKeyPair,
  STAMP_HEADER,
  verifyApiKeyStamp,
} from './stamp.js';

const body = JSON.stringify({ type: 'ACTIVITY_TYPE_CREATE_WALLET', organizationId: 'org' });

describe('API key stamps', () => {
  it('round trips with a hex key pair', async () => {
    const pair = generateApiKeyPair();
    const stamp = await createApiKeyStamper(pair).stamp(body);
    expect(stamp.header).toBe(STAMP_HEADER);
    expect(verifyApiKeyStamp(body, stamp)).toEqual({ publicKey: pair.publicKey });
  });

  it('rejects a different body, a tampered stamp and garbage', async () => {
    const stamp = await createApiKeyStamper(generateApiKeyPair()).stamp(body);
    expect(verifyApiKeyStamp(`${body} `, stamp)).toBeNull();
    expect(
      verifyApiKeyStamp(body, { ...stamp, value: `${stamp.value.slice(0, -4)}AAAA` }),
    ).toBeNull();
    expect(verifyApiKeyStamp(body, { header: STAMP_HEADER, value: 'not-a-stamp' })).toBeNull();
    expect(verifyApiKeyStamp(body, { header: 'X-Stamp-WebAuthn', value: stamp.value })).toBeNull();
  });

  it('refuses a mismatched key pair', () => {
    const a = generateApiKeyPair();
    const b = generateApiKeyPair();
    expect(() => createApiKeyStamper({ publicKey: b.publicKey, privateKey: a.privateKey })).toThrow(
      /mismatch/,
    );
  });

  it('stamps with a non-extractable WebCrypto key (the iframe session key)', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
      'sign',
    ]);
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    const publicKey = compressP256PublicKey(raw);
    const stamp = await createCryptoKeyStamper(pair.privateKey, publicKey).stamp(body);
    expect(verifyApiKeyStamp(body, stamp)).toEqual({ publicKey });
  });
});
