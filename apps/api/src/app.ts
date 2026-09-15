import { createDb } from '@pocketkey/db';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type { AppEnv } from './context.js';
import { parseEnv } from './env.js';
import { ApiError, handleError } from './errors.js';
import { getKeyProvider } from './lib/key-provider.js';
import { APP_ID_HEADER } from './middleware/app.js';
import { requestId } from './middleware/request-id.js';
import { appRoutes } from './routes/apps.js';
import { health } from './routes/health.js';

export function createApp() {
  const app = new Hono<AppEnv>();

  app.onError(handleError);
  app.notFound((c) => {
    throw new ApiError('not_found', `No route for ${c.req.method} ${c.req.path}`);
  });

  app.use(requestId);
  app.use(secureHeaders());
  app.use(async (c, next) => {
    const config = parseEnv(c.env);
    c.set('config', config);
    c.set('db', createDb(c.env.DB));
    c.set('keyProvider', getKeyProvider(config));
    await next();
  });

  // Browser SDK calls come from developer origins. The per-app allowlist is
  // enforced in `requireApp`; CORS itself reflects any origin so preflights
  // reach the real check and get a documented error instead of an opaque one.
  app.use(
    '/v1/*',
    cors({
      origin: (origin) => origin,
      allowHeaders: ['Content-Type', 'Authorization', APP_ID_HEADER, 'X-Request-Id'],
      exposeHeaders: ['X-Request-Id'],
      maxAge: 600,
      credentials: true,
    }),
  );

  app.route('/health', health);
  app.route('/v1/apps', appRoutes);

  return app;
}

export type App = ReturnType<typeof createApp>;
