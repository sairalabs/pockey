import { createDb } from '@pocketkey/db';
import { DEVICE_ID_HEADER } from '@pocketkey/types';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { AUTH_COOKIES_HEADER } from './auth/cookie-bridge.js';
import type { AppEnv } from './context.js';
import { parseEnv } from './env.js';
import { ApiError, handleError } from './errors.js';
import { getKeyProvider } from './lib/key-provider.js';
import { getMailer } from './lib/mailer.js';
import { APP_ID_HEADER } from './middleware/app.js';
import { requestId } from './middleware/request-id.js';
import { appRoutes } from './routes/apps.js';
import { authRoutes } from './routes/auth.js';
import { health } from './routes/health.js';
import { meRoutes } from './routes/me.js';
import { walletRoutes } from './routes/wallets.js';

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
    c.set('mailer', getMailer(config));
    await next();
  });

  // Browser SDK calls come from developer origins and from the embed iframe.
  // The per-app allowlist is enforced in `requireApp`; CORS reflects the origin
  // so preflights reach that check and get a documented error, not an opaque one.
  app.use(
    '/v1/*',
    cors({
      origin: (origin) => origin,
      allowHeaders: [
        'Content-Type',
        'Authorization',
        APP_ID_HEADER,
        DEVICE_ID_HEADER,
        AUTH_COOKIES_HEADER,
        'X-Request-Id',
      ],
      exposeHeaders: ['X-Request-Id', AUTH_COOKIES_HEADER],
      maxAge: 600,
      credentials: true,
    }),
  );

  app.route('/health', health);
  app.route('/v1/apps', appRoutes);
  app.route('/v1/auth', authRoutes);
  app.route('/v1/me', meRoutes);
  app.route('/v1/wallets', walletRoutes);

  return app;
}

export type App = ReturnType<typeof createApp>;
