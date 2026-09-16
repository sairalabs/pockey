/** Byte helpers. Kept tiny on purpose: no buffer polyfill, no base58 dependency. */

export function utf8ToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Decodes a base58 (Bitcoin alphabet) string. Throws on invalid characters. */
export function base58ToBytes(input: string): Uint8Array {
  const bytes: number[] = [];
  for (const char of input) {
    let carry = BASE58_ALPHABET.indexOf(char);
    if (carry < 0) throw new Error(`Invalid base58 character "${char}"`);
    for (let i = 0; i < bytes.length; i++) {
      carry += (bytes[i] ?? 0) * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Each leading "1" encodes a leading zero byte.
  for (const char of input) {
    if (char !== '1') break;
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}

export const isHex = (value: unknown): value is `0x${string}` =>
  typeof value === 'string' && /^0x[0-9a-fA-F]*$/.test(value);

/** `0x1f` to `"31"`. Throws on anything that is not a hex quantity. */
export function hexToDecimalString(value: string): string {
  if (!/^0x[0-9a-fA-F]+$/.test(value)) throw new Error(`Expected a hex quantity, got "${value}"`);
  return BigInt(value).toString(10);
}

export const toHexQuantity = (value: number): `0x${string}` => `0x${value.toString(16)}`;
