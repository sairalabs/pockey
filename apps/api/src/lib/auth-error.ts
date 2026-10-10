import type { ApiErrorCode } from '@pockey/types';
import { errorBody } from '../errors.js';

/**
 * Better Auth answers `{ code, message }`; every Pockey response uses the
 * documented `{ error: { code, message, details?, requestId } }` shape instead.
 * Shared by the end user proxy (`/v1/auth/*`) and the developer one (`/admin/auth/*`).
 * Redirects and successes pass through untouched, cookies included.
 */
export async function normalizeAuthError(requestId: string, response: Response): Promise<Response> {
  if (response.ok || response.status < 400) return response;

  let message = response.statusText || 'Authentication failed';
  let details: unknown;
  try {
    const body = await response.clone().json<{ code?: string; message?: string }>();
    if (body.message) message = body.message;
    if (body.code) details = { betterAuthCode: body.code };
  } catch {
    // Non JSON error body, keep the status text.
  }

  const code: ApiErrorCode =
    response.status === 401
      ? 'unauthorized'
      : response.status === 403
        ? 'forbidden'
        : response.status === 404
          ? 'not_found'
          : response.status === 429
            ? 'rate_limited'
            : response.status >= 500
              ? 'internal'
              : 'bad_request';

  const normalized = new Response(JSON.stringify(errorBody(code, message, requestId, details)), {
    status: response.status,
    headers: response.headers,
  });
  normalized.headers.set('Content-Type', 'application/json');
  return normalized;
}
