/** SHA-256 hex using WebCrypto, available in Workers, Node 20+ and browsers. */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Display prefix stored next to the hash: `pk_sk_abcdef`. */
export function apiKeyPrefix(secret: string): string {
  return secret.slice(0, 12);
}
