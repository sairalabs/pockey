import type { NextRequest } from 'next/server';
import { API_URL } from '@/lib/api.server';

/**
 * Same origin proxy for the admin API.
 *
 * The browser only ever talks to the dashboard: this handler forwards method,
 * query, body and cookies to `${POCKEY_API_URL}/admin/...` and hands the
 * answer back with its `Set-Cookie` headers. The developer session cookie is
 * therefore a first party cookie of the dashboard origin, which removes both
 * the CORS preflight and the third party cookie problem.
 */

export const dynamic = 'force-dynamic';

/** Request headers worth forwarding. Everything else is noise or is rewritten. */
const FORWARD_REQUEST = ['cookie', 'content-type', 'accept', 'origin', 'user-agent'];
/** Response headers worth forwarding. `set-cookie` is handled separately. */
const FORWARD_RESPONSE = ['content-type', 'location', 'x-request-id', 'cache-control'];

async function proxy(request: NextRequest, path: string[]): Promise<Response> {
  const target = new URL(`/admin/${path.join('/')}`, API_URL);
  target.search = request.nextUrl.search;

  const headers = new Headers();
  for (const name of FORWARD_REQUEST) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const body = hasBody ? await request.arrayBuffer() : null;

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: body && body.byteLength > 0 ? body : null,
      // The GitHub callback answers a 302 to the dashboard: hand it to the
      // browser instead of following it on the server, where the cookies of the
      // redirect would be lost.
      redirect: 'manual',
      cache: 'no-store',
    });
  } catch {
    return Response.json(
      {
        error: {
          code: 'internal',
          message: `The Pockey API at ${API_URL} is unreachable`,
        },
      },
      { status: 502 },
    );
  }

  const out = new Headers();
  for (const name of FORWARD_RESPONSE) {
    const value = upstream.headers.get(name);
    if (value !== null) out.set(name, value);
  }
  // Session, OTP and OAuth state cookies: forwarded verbatim, so the browser
  // stores them against the dashboard origin.
  for (const cookie of upstream.headers.getSetCookie()) out.append('set-cookie', cookie);

  // `content-length` and `content-encoding` are dropped on purpose: fetch has
  // already decoded the body, so the upstream values no longer describe it.
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

interface Context {
  params: Promise<{ path: string[] }>;
}

async function handler(request: NextRequest, context: Context): Promise<Response> {
  const { path } = await context.params;
  return proxy(request, path);
}

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
export const DELETE = handler;
