import { base64 } from '@scure/base';
import { isRecord } from './guards';

export interface EphemeralKey {
  /** Base64 SPKI of the P-256 public key sent to the key provider. */
  publicKey: string;
  /** Never leaves this document. Needed to decrypt the export bundle. */
  privateKey: CryptoKey;
}

export async function generateEphemeralKey(): Promise<EphemeralKey> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
    'deriveBits',
  ]);
  const spki = await crypto.subtle.exportKey('spki', pair.publicKey);
  return { publicKey: base64.encode(new Uint8Array(spki)), privateKey: pair.privateKey };
}

/** True when the bundle is the mock key provider marker (base64 JSON with `mock: true`). */
export function isMockBundle(bundle: string): boolean {
  const candidates: string[] = [bundle];
  try {
    candidates.push(new TextDecoder().decode(base64.decode(bundle)));
  } catch {
    // Not base64, only the raw string is a candidate.
  }
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (isRecord(parsed) && parsed.mock === true) return true;
    } catch {
      // Not JSON.
    }
  }
  return false;
}
