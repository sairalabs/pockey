import { createDb } from '@pockey/db';
import { DEVICE_ID_HEADER } from '@pockey/types';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type { AppEnv } from './context.js';
import { parseEnv, type Env } from './env.js';
import { ApiError, handleError } from './errors.js';
import { getKeyProvider } from './lib/key-provider.js';
import { getMailer } from './lib/mailer.js';
import { APP_ID_HEADER } from './middleware/app.js';
import { appRateLimit, authRateLimit } from './middleware/rate-limit.js';
import { requestId } from './middleware/request-id.js';
import { adminRoutes } from './routes/admin.js';
import { adminAuthRoutes } from './routes/admin-auth.js';
import { appRoutes } from './routes/apps.js';
import { authRoutes } from './routes/auth.js';
import { health } from './routes/health.js';
import { meRoutes } from './routes/me.js';
import { serverRoutes } from './routes/server.js';
import { sessionRoutes } from './routes/sessions.js';
import { sponsorRoutes } from './routes/sponsor.js';
import { walletRoutes } from './routes/wallets.js';
import { webhookRoutes } from './routes/webhooks.js';

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
    const mailer = getMailer(config);
    c.set('mailer', mailer);
    c.set('keyProvider', getKeyProvider(config, mailer));
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
        'X-Request-Id',
      ],
      exposeHeaders: ['X-Request-Id'],
      maxAge: 600,
      credentials: true,
    }),
  );

  // T5.5, after CORS so a preflight is never counted and never rate limited.
  // `/health`, `/webhooks/*` and `/admin/*` are deliberately left out.
  app.use('/v1/*', appRateLimit);
  app.use('/v1/auth/*', authRateLimit);

  // The dashboard is the only browser origin allowed on /admin/*, and it sends
  // the developer session cookie, so the allowlist is a single exact origin.
  app.use(
    '/admin/*',
    cors({
      origin: (_origin, c) => parseEnv(c.env as Env).DASHBOARD_ORIGIN,
      allowHeaders: ['Content-Type', 'X-Request-Id'],
      exposeHeaders: ['X-Request-Id'],
      allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      maxAge: 600,
      credentials: true,
    }),
  );

  app.route('/health', health);
  app.route('/v1/apps', appRoutes);
  app.route('/v1/auth', authRoutes);
  app.route('/v1/me', meRoutes);
  app.route('/v1/wallets', walletRoutes);
  app.route('/v1/sessions', sessionRoutes);
  app.route('/v1/server', serverRoutes);
  app.route('/v1/sponsor', sponsorRoutes);
  // Dashboard (T5.1). /admin/auth is public (sign-in), the rest needs a session.
  app.route('/admin/auth', adminAuthRoutes);
  app.route('/admin', adminRoutes);
  // Provider webhooks: outside /v1, so no app header and no CORS.
  app.route('/webhooks', webhookRoutes);

  return app;
}

export type App = ReturnType<typeof createApp>;
