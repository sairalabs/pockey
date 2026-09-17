import { apps, type AppRow } from '@pocketkey/db';
import { AppId } from '@pocketkey/types';
import { and, eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { createDeveloperAuth } from '../auth/developer-auth.js';
import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';
import { ensureDeveloper } from '../services/developers.js';

/**
 * Every `/admin/*` route except `/admin/auth/*` (spec section 7.2). Resolves the
 * Better Auth developer session to a `developers` row, creating it on first
 * sign-in, and sets `developer`. No session is a 401, never a redirect: the
 * dashboard decides what to show.
 */
export const requireDeveloper = createMiddleware<AppEnv>(async (c, next) => {
  const auth = createDeveloperAuth({
    db: c.var.db,
    config: c.var.config,
    mailer: c.var.mailer,
  });
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) throw new ApiError('unauthorized', 'No developer session');

  c.set('developer', await ensureDeveloper(c.var.db, session.user));
  await next();
});

/**
 * Loads an app of the session developer. An app of another developer is a 404,
 * exactly like an unknown id: the dashboard never learns that it exists.
 */
export async function loadOwnedApp(c: Context<AppEnv>): Promise<AppRow> {
  const id = AppId.safeParse(c.req.param('id'));
  if (!id.success) throw new ApiError('not_found', 'App not found');

  const app = await c.var.db.query.apps.findFirst({
    where: and(eq(apps.id, id.data), eq(apps.developerId, c.var.developer.id)),
  });
  if (!app) throw new ApiError('not_found', 'App not found');
  return app;
}
