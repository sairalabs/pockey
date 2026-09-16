/**
 * Cookie bridge for the embed iframe.
 *
 * The iframe of section 4.1 is a third-party context on the developer's page,
 * where Safari (and Chrome without CHIPS) drops cookies. Better Auth keeps its
 * session and WebAuthn challenge in cookies, so the API mirrors them into a
 * header the iframe can store and send back:
 *
 *   response: Set-Cookie: a=1; ...   ->  X-Pocketkey-Auth-Cookies: a=1
 *   request:  X-Pocketkey-Auth-Cookies: a=1  ->  Cookie: a=1 (server side only)
 *
 * The values are signed opaque strings. They stay inside the iframe origin,
 * which already holds the Pocketkey tokens, so no new exposure is introduced.
 */

export const AUTH_COOKIES_HEADER = 'X-Pocketkey-Auth-Cookies';

interface ParsedSetCookie {
  name: string;
  value: string;
  expired: boolean;
}

function parseSetCookie(header: string): ParsedSetCookie | null {
  const [pair, ...attributes] = header.split(';');
  if (!pair) return null;
  const eq = pair.indexOf('=');
  if (eq <= 0) return null;
  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  const expired = attributes.some((attr) => {
    const [key, raw] = attr.split('=').map((part) => part.trim().toLowerCase());
    if (key === 'max-age') return Number(raw) <= 0;
    if (key === 'expires' && raw) return Date.parse(raw) <= Date.now();
    return false;
  });
  return { name, value, expired: expired || value === '' };
}

function parseCookieHeader(header: string | null | undefined): Map<string, string> {
  const jar = new Map<string, string>();
  if (!header) return jar;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    jar.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
  return jar;
}

function serialize(jar: Map<string, string>): string {
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

/** Builds the headers Better Auth should see: real cookies plus bridged ones. */
export function withBridgedCookies(source: Headers): Headers {
  const headers = new Headers(source);
  const jar = parseCookieHeader(source.get('Cookie'));
  for (const [name, value] of parseCookieHeader(source.get(AUTH_COOKIES_HEADER))) {
    if (!jar.has(name)) jar.set(name, value);
  }
  headers.delete(AUTH_COOKIES_HEADER);
  if (jar.size > 0) headers.set('Cookie', serialize(jar));
  else headers.delete('Cookie');
  return headers;
}

/**
 * Merges the request's bridged cookies with what Better Auth just set or
 * cleared, and writes the result to the response header.
 */
export function bridgeResponseCookies(requestHeaders: Headers, response: Response): Response {
  const setCookies = response.headers.getSetCookie();
  if (setCookies.length === 0) return response;

  const jar = parseCookieHeader(requestHeaders.get(AUTH_COOKIES_HEADER));
  for (const header of setCookies) {
    const parsed = parseSetCookie(header);
    if (!parsed) continue;
    if (parsed.expired) jar.delete(parsed.name);
    else jar.set(parsed.name, parsed.value);
  }

  const bridged = new Response(response.body, response);
  bridged.headers.set(AUTH_COOKIES_HEADER, serialize(jar));
  return bridged;
}

/** Cookie header for an internal `auth.api.getSession` call after a sign-in response. */
export function cookieHeadersFrom(response: Response, base: Headers): Headers {
  const headers = withBridgedCookies(base);
  const jar = parseCookieHeader(headers.get('Cookie'));
  for (const header of response.headers.getSetCookie()) {
    const parsed = parseSetCookie(header);
    if (!parsed) continue;
    if (parsed.expired) jar.delete(parsed.name);
    else jar.set(parsed.name, parsed.value);
  }
  if (jar.size > 0) headers.set('Cookie', serialize(jar));
  return headers;
}
