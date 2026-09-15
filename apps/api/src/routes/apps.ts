import { AppConfig, PublicAppConfig, PublicAppId } from '@pocketkey/types';
import { Hono } from 'hono';
import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';
import { requireApp } from '../middleware/app.js';

/**
 * `GET /v1/apps/:appId/config` (section 7.2). Public, no user session needed.
 * Edge caching (T1.5) is added later; the shape is final now so the SDK can
 * build against it.
 */
export const appRoutes = new Hono<AppEnv>().get('/:appId/config', requireApp, (c) => {
  const app = c.var.app;
  const requested = c.req.param('appId');
  if (requested !== app.publicId) {
    throw new ApiError('forbidden', 'Path app id does not match the header app id');
  }

  const config = AppConfig.parse(app.config);
  const body: PublicAppConfig = {
    appId: PublicAppId.parse(app.publicId),
    name: app.name,
    loginMethods: config.loginMethods,
    chains: config.chains,
    appearance: config.appearance,
    embeddedWallets: { createOnLogin: config.embeddedWallets.createOnLogin },
  };
  return c.json(PublicAppConfig.parse(body));
});
