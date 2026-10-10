import { MeResponse } from '@pockey/types';
import { Hono } from 'hono';
import type { AppEnv } from '../context.js';
import { requireApp } from '../middleware/app.js';
import { requireUser } from '../middleware/user.js';
import { loadEndUser } from '../services/end-users.js';
import { keySessionOf, loadEndUserRow } from '../services/key-session.js';

/**
 * `GET /v1/me` (section 7.2): the signed-in end user with identities and wallets,
 * plus where the iframe session key acts at the key provider.
 */
export const meRoutes = new Hono<AppEnv>().get('/', requireApp, requireUser, async (c) => {
  const user = await loadEndUser(c.var.db, c.var.app, c.var.endUserId);
  const keySession = keySessionOf(await loadEndUserRow(c.var.db, c.var.app, c.var.endUserId));
  return c.json(MeResponse.parse({ user, keySession }));
});
