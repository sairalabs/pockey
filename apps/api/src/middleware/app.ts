import { PublicAppId } from '@pockey/types';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';
import { loadAppByPublicId } from '../lib/apps.js';

export const APP_ID_HEADER = 'X-Pockey-App-Id';

/**
 * Every `/v1/*` route. Resolves the public app id to its row and
 * checks the browser `Origin` against the app allowlist plus the embed origin
 * (the iframe calls the API from its own origin).
 * Server-to-server calls carry no Origin and are gated by the API key instead.
 */
export const requireApp = createMiddleware<AppEnv>(async (c, next) => {
  const raw = c.req.header(APP_ID_HEADER);
  if (!raw) throw new ApiError('app_id_missing', `Missing ${APP_ID_HEADER} header`);

  const parsed = PublicAppId.safeParse(raw);
  if (!parsed.success) throw new ApiError('app_id_invalid', 'Malformed app id');

  const { app, cache } = await loadAppByPublicId(c.var.db, parsed.data);
  if (!app) throw new ApiError('app_id_invalid', 'Unknown app id');

  const origin = c.req.header('Origin');
  if (origin && !isOriginAllowed(origin, [...app.allowedOrigins, c.var.config.EMBED_ORIGIN])) {
    throw new ApiError('origin_not_allowed', `Origin ${origin} is not allowed for this app`);
  }

  c.set('app', app);
  c.header('X-Pockey-App-Cache', cache);
  await next();
});

export function isOriginAllowed(origin: string, allowed: readonly string[]): boolean {
  if (allowed.length === 0) return false;
  let normalized: string;
  try {
    normalized = new URL(origin).origin;
  } catch {
    return false;
  }
  return allowed.some((entry) => {
    try {
      return new URL(entry).origin === normalized;
    } catch {
      return false;
    }
  });
}
