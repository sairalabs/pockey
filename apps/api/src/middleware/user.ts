import { createMiddleware } from 'hono/factory';
import { verifyAccessToken } from '../auth/tokens.js';
import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';
import { enforceRateLimit } from './rate-limit.js';

/**
 * End user routes. Requires `requireApp` first.
 * Sets `endUserId` and `sessionFamilyId`, and applies the per end user rate
 * limit once the token proves who is calling.
 */
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header('Authorization');
  const match = header ? /^Bearer\s+(.+)$/i.exec(header) : null;
  const token = match?.[1];
  if (!token) throw new ApiError('unauthorized', 'Missing bearer access token');

  const claims = await verifyAccessToken({
    db: c.var.db,
    config: c.var.config,
    app: c.var.app,
    token,
  });

  c.set('endUserId', claims.sub);
  c.set('sessionFamilyId', claims.sid);
  await enforceRateLimit(c, 'user', claims.sub);
  await next();
});
