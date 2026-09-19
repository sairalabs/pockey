import { z } from 'zod';
import type { ParsedEnv } from '../env.js';
import { ApiError } from '../errors.js';
import { randomBytes, sha256Hex, toBase64Url } from './crypto.js';

/**
 * Google and Apple sign-in as plain OpenID Connect (authorization code flow).
 *
 * The iframe sends its session public key when it opens the popup; the OIDC nonce
 * is SHA-256 of that key. The key provider only accepts an OIDC token whose nonce
 * commits to the key it registers, so the ID token we receive can log in the
 * iframe's key and nothing else, even in our hands.
 */

export type OidcProvider = 'google' | 'apple';

interface ProviderConfig {
  authorizeUrl: string;
  tokenUrl: string;
  issuer: string;
  scope: string;
  /** Apple posts the callback as a form when name or email is requested. */
  responseMode?: 'form_post';
  pkce: boolean;
}

const PROVIDERS: Record<OidcProvider, ProviderConfig> = {
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    issuer: 'https://accounts.google.com',
    scope: 'openid email profile',
    pkce: true,
  },
  apple: {
    authorizeUrl: 'https://appleid.apple.com/auth/authorize',
    tokenUrl: 'https://appleid.apple.com/auth/token',
    issuer: 'https://appleid.apple.com',
    scope: 'name email',
    responseMode: 'form_post',
    pkce: false,
  },
};

export function oidcCredentials(
  config: ParsedEnv,
  provider: OidcProvider,
): { clientId: string; clientSecret: string } | null {
  const clientId = provider === 'google' ? config.GOOGLE_CLIENT_ID : config.APPLE_CLIENT_ID;
  const clientSecret =
    provider === 'google' ? config.GOOGLE_CLIENT_SECRET : config.APPLE_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function callbackUrl(config: ParsedEnv, provider: OidcProvider): string {
  return `${new URL(config.API_BASE_URL).origin}/v1/auth/callback/${provider}`;
}

/** Nonce committing to the session key, as the key provider expects it. */
export async function nonceFor(sessionPublicKey: string): Promise<string> {
  return sha256Hex(sessionPublicKey);
}

async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return toBase64Url(new Uint8Array(digest));
}

export interface AuthorizationStart {
  url: string;
  state: string;
  codeVerifier: string | null;
}

export async function startAuthorization(input: {
  provider: OidcProvider;
  clientId: string;
  redirectUri: string;
  nonce: string;
}): Promise<AuthorizationStart> {
  const provider = PROVIDERS[input.provider];
  const state = toBase64Url(randomBytes(32));
  const codeVerifier = provider.pkce ? toBase64Url(randomBytes(48)) : null;
  const url = new URL(provider.authorizeUrl);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', provider.scope);
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', input.nonce);
  if (provider.responseMode) url.searchParams.set('response_mode', provider.responseMode);
  if (codeVerifier) {
    url.searchParams.set('code_challenge', await s256(codeVerifier));
    url.searchParams.set('code_challenge_method', 'S256');
  }
  if (input.provider === 'google') url.searchParams.set('prompt', 'select_account');
  return { url: url.toString(), state, codeVerifier };
}

const TokenResponse = z.object({ id_token: z.string().min(1) });

export const IdTokenClaims = z.object({
  iss: z.string(),
  sub: z.string().min(1),
  aud: z.union([z.string(), z.array(z.string())]),
  nonce: z.string().optional(),
  email: z.string().optional(),
  email_verified: z.union([z.boolean(), z.enum(['true', 'false'])]).optional(),
});
export type IdTokenClaims = z.infer<typeof IdTokenClaims>;

export function decodeIdToken(idToken: string): IdTokenClaims {
  const payload = idToken.split('.')[1];
  if (!payload) throw new ApiError('bad_request', 'Malformed ID token');
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const json = new TextDecoder().decode(
    Uint8Array.from(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)), (char) =>
      char.charCodeAt(0),
    ),
  );
  const parsed = IdTokenClaims.safeParse(JSON.parse(json));
  if (!parsed.success) throw new ApiError('bad_request', 'Malformed ID token');
  return parsed.data;
}

/**
 * Exchanges the code at the provider's token endpoint. The ID token comes straight
 * from the provider over TLS and is authenticated by our client secret, so its
 * claims are trusted as is (OIDC core 3.1.3.7). The key provider verifies it again.
 */
export async function exchangeCode(input: {
  provider: OidcProvider;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  codeVerifier: string | null;
  expectedNonce: string;
  fetch?: typeof fetch;
}): Promise<{ idToken: string; claims: IdTokenClaims }> {
  const provider = PROVIDERS[input.provider];
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    client_secret: input.clientSecret,
  });
  if (input.codeVerifier) form.set('code_verifier', input.codeVerifier);
  const doFetch = input.fetch ?? ((url, init) => fetch(url, init));
  let response: Response;
  try {
    response = await doFetch(provider.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form.toString(),
    });
  } catch {
    throw new ApiError('bad_request', `Could not reach ${input.provider}`);
  }
  const body = TokenResponse.safeParse(await response.json().catch(() => null));
  if (!response.ok || !body.success) {
    throw new ApiError('bad_request', `${input.provider} refused the sign-in`);
  }
  const claims = decodeIdToken(body.data.id_token);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== provider.issuer && claims.iss !== provider.issuer.replace('https://', '')) {
    throw new ApiError('bad_request', 'ID token from an unexpected issuer');
  }
  if (!audiences.includes(input.clientId)) {
    throw new ApiError('bad_request', 'ID token for another client');
  }
  if (claims.nonce !== input.expectedNonce) {
    throw new ApiError('bad_request', 'ID token nonce does not match the session key');
  }
  return { idToken: body.data.id_token, claims };
}
