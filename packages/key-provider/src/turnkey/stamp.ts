import { p256 } from '@noble/curves/nist.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { base64urlnopad } from '@scure/base';

/**
 * Turnkey request stamps (API key scheme). A stamp proves that the holder of a
 * P-256 key approved this exact request body: Turnkey verifies it before running
 * the activity, so whoever relays the request cannot change a single byte.
 *
 * Wire format, sent as the `X-Stamp` header:
 *   base64url(JSON { publicKey: compressed hex, scheme, signature: DER hex })
 * where the signature is ECDSA P-256 over SHA-256(body).
 *
 * Pure: runs in Workers, browsers and Node.
 */

export const STAMP_HEADER = 'X-Stamp';
export const WEBAUTHN_STAMP_HEADER = 'X-Stamp-WebAuthn';
export const API_KEY_SCHEME = 'SIGNATURE_SCHEME_TK_API_P256';

export interface Stamp {
  header: typeof STAMP_HEADER | typeof WEBAUTHN_STAMP_HEADER;
  value: string;
}

export interface Stamper {
  /** Compressed P-256 public key (hex, 33 bytes), as registered at the provider. */
  readonly publicKey: string;
  stamp(body: string): Promise<Stamp>;
}

interface ApiKeyStampJson {
  publicKey: string;
  scheme: string;
  signature: string;
}

const encoder = new TextEncoder();

function encodeStamp(publicKey: string, derSignatureHex: string): Stamp {
  const json: ApiKeyStampJson = {
    publicKey,
    scheme: API_KEY_SCHEME,
    signature: derSignatureHex,
  };
  return {
    header: STAMP_HEADER,
    value: base64urlnopad.encode(encoder.encode(JSON.stringify(json))),
  };
}

/** A P-256 key pair in Turnkey hex encoding. The private key is a 32-byte scalar. */
export interface ApiKeyPair {
  publicKey: string;
  privateKey: string;
}

export function generateApiKeyPair(): ApiKeyPair {
  const secret = p256.utils.randomSecretKey();
  return { privateKey: bytesToHex(secret), publicKey: bytesToHex(p256.getPublicKey(secret, true)) };
}

/** Stamper for keys held as hex (server credentials, tests). */
export function createApiKeyStamper(pair: ApiKeyPair): Stamper {
  const secret = hexToBytes(pair.privateKey);
  const derived = bytesToHex(p256.getPublicKey(secret, true));
  if (derived !== pair.publicKey.toLowerCase()) {
    // Same check as the Turnkey SDK: a mismatched pair would fail every request.
    throw new Error('Turnkey API key pair mismatch: the public key does not match the private key');
  }
  return {
    publicKey: derived,
    async stamp(body) {
      const signature = p256.sign(encoder.encode(body), secret, { prehash: true, format: 'der' });
      return encodeStamp(derived, bytesToHex(signature));
    },
  };
}

/**
 * Stamper for a non-extractable WebCrypto key (the iframe session key). WebCrypto
 * returns IEEE P1363 (r || s); Turnkey wants DER.
 */
export function createCryptoKeyStamper(key: CryptoKey, compressedPublicKey: string): Stamper {
  return {
    publicKey: compressedPublicKey,
    async stamp(body) {
      const raw = new Uint8Array(
        await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(body)),
      );
      const der = p256.Signature.fromBytes(raw, 'compact').toBytes('der');
      return encodeStamp(compressedPublicKey, bytesToHex(der));
    },
  };
}

/** Compressed hex public key of an uncompressed SEC1 or raw WebCrypto export. */
export function compressP256PublicKey(uncompressed: Uint8Array): string {
  return p256.Point.fromBytes(uncompressed).toHex(true);
}

export interface VerifiedStamp {
  publicKey: string;
}

/**
 * Checks an API key stamp against a body. Used by the provider emulator and by
 * the API to learn which public key signed a request before relaying it.
 * Returns null when the stamp is malformed or the signature does not verify.
 */
export function verifyApiKeyStamp(body: string, stamp: Stamp): VerifiedStamp | null {
  if (stamp.header !== STAMP_HEADER) return null;
  let parsed: ApiKeyStampJson;
  try {
    parsed = JSON.parse(
      new TextDecoder().decode(base64urlnopad.decode(stamp.value)),
    ) as ApiKeyStampJson;
  } catch {
    return null;
  }
  if (
    parsed.scheme !== API_KEY_SCHEME ||
    typeof parsed.publicKey !== 'string' ||
    typeof parsed.signature !== 'string'
  ) {
    return null;
  }
  try {
    const ok = p256.verify(
      hexToBytes(parsed.signature),
      encoder.encode(body),
      hexToBytes(parsed.publicKey),
      { prehash: true, format: 'der', lowS: false },
    );
    return ok ? { publicKey: parsed.publicKey.toLowerCase() } : null;
  } catch {
    return null;
  }
}
