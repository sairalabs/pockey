/** Small WebCrypto helpers shared by auth code. Workers, Node 20+ and browsers. */

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Alphanumeric, suitable for SIWE nonces (EIP-4361 requires [a-zA-Z0-9]{8,}). */
export function randomAlphanumeric(length: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  // Rejection sampling keeps the distribution uniform.
  let out = '';
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < 248 && out.length < length) out += alphabet[byte % 62] ?? '';
    }
  }
  return out;
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return toHex(new Uint8Array(digest));
}

/**
 * Derives a purpose-bound subkey from a master secret with HKDF-SHA256, so one
 * Wrangler secret can back several uses without them ever sharing key material.
 */
export async function deriveKeyHex(masterSecret: string, purpose: string): Promise<string> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(masterSecret),
    'HKDF',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode('pocketkey'),
      info: new TextEncoder().encode(purpose),
    },
    baseKey,
    256,
  );
  return toHex(new Uint8Array(bits));
}
