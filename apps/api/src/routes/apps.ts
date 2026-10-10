import { AppConfig, PublicAppConfig, PublicAppId } from '@pockey/types';
import { Hono } from 'hono';
import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';
import { APP_CACHE_TTL_SECONDS } from '../lib/apps.js';
import { requireApp } from '../middleware/app.js';

/**
 * `GET /v1/apps/:appId/config` (section 7.2, T1.5). Public, no user session.
 * The app row comes from the edge cache in `requireApp`; browsers may keep the
 * response for 60 seconds. `Vary` keeps the per-origin CORS answer correct.
 */
export const appRoutes = new Hono<AppEnv>().get('/:appId/config', requireApp, (c) => {
  c.header('Cache-Control', `public, max-age=${APP_CACHE_TTL_SECONDS}`);
  c.header('Vary', 'Origin, X-Pockey-App-Id');
  const app = c.var.app;
  const requested = c.req.param('appId');
  if (requested !== app.publicId) {
    throw new ApiError('forbidden', 'Path app id does not match the header app id');
  }

  const config = AppConfig.parse(app.config);
  const facts = c.var.keyProvider.info();
  const body: PublicAppConfig = {
    appId: PublicAppId.parse(app.publicId),
    name: app.name,
    loginMethods: config.loginMethods,
    chains: config.chains,
    appearance: config.appearance,
    embeddedWallets: { createOnLogin: config.embeddedWallets.createOnLogin },
    allowedOrigins: app.allowedOrigins,
    keyProvider: {
      kind: facts.kind,
      organizationId: facts.organizationId,
      signerPublicKey: facts.signerPublicKey,
      ...(facts.enclaveSignerPublicKey
        ? { enclaveSignerPublicKey: facts.enclaveSignerPublicKey }
        : {}),
    },
  };
  return c.json(PublicAppConfig.parse(body));
});
