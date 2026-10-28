import { endUsers, sessionSigners, wallets } from '@pockey/db';
import {
  ApiErrorBody,
  EndUserId,
  ServerSignInput,
  ServerUserList,
  SessionSignOutput,
  SponsorBalance,
  TopUpCheckoutInput,
  TopUpCheckoutOutput,
  WalletId,
} from '@pockey/types';
import { PaymentsError } from '@pockey/payments';
import { and, eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context.js';
import { ApiError, errorBody } from '../errors.js';
import { getRpcFactory } from '../lib/rpc.js';
import { getPayments, sponsorRuntime } from '../lib/sponsor.js';
import { validate } from '../lib/validate.js';
import { requireApiKey } from '../middleware/api-key.js';
import { requireApp } from '../middleware/app.js';
import { EndUserListQuery, listEndUsers } from '../services/end-users.js';
import { signWithSession, type SessionDeps } from '../services/sessions.js';
import { getBalance } from '../services/sponsoring.js';

const deps = (c: Context<AppEnv>): SessionDeps => ({
  db: c.var.db,
  keyProvider: c.var.keyProvider,
  rpc: getRpcFactory(c.var.config),
  app: c.var.app,
  sponsor: sponsorRuntime(c),
});

const SignParams = z.object({ id: EndUserId, wid: WalletId });

/** Server routes, authenticated by a secret API key. */
export const serverRoutes = new Hono<AppEnv>()
  .use(requireApp, requireApiKey)

  .get('/users', validate('query', EndUserListQuery), async (c) => {
    const page = await listEndUsers(c.var.db, c.var.app, c.req.valid('query'));
    return c.json(ServerUserList.parse(page));
  })

  .post('/users/:id/wallets/:wid/sign', validate('json', ServerSignInput), async (c) => {
    const params = SignParams.safeParse(c.req.param());
    if (!params.success) throw new ApiError('not_found', 'Session not found');
    const { id: endUserId, wid: walletId } = params.data;
    const { sessionId, request } = c.req.valid('json');

    // Session -> wallet -> user -> this app, all in one lookup. Any break is a 404.
    const [row] = await c.var.db
      .select({ session: sessionSigners })
      .from(sessionSigners)
      .innerJoin(wallets, eq(wallets.id, sessionSigners.walletId))
      .innerJoin(endUsers, eq(endUsers.id, wallets.endUserId))
      .where(
        and(
          eq(sessionSigners.id, sessionId),
          eq(wallets.id, walletId),
          eq(endUsers.id, endUserId),
          eq(endUsers.appId, c.var.app.id),
        ),
      )
      .limit(1);
    if (!row) throw new ApiError('not_found', 'Session not found');

    const out = await signWithSession(deps(c), row.session, request, { via: 'server' });
    return c.json(SessionSignOutput.parse(out));
  })

  /* Gas sponsoring balance */

  .get('/sponsoring/balance', async (c) => {
    return c.json(SponsorBalance.parse(await getBalance(c.var.db, c.var.app)));
  })

  .post('/sponsoring/checkout', validate('json', TopUpCheckoutInput), async (c) => {
    const { amountCents, successUrl, cancelUrl } = c.req.valid('json');
    try {
      const checkout = await getPayments(c.var.config).createTopUpCheckout({
        appId: c.var.app.id,
        amountCents,
        successUrl,
        cancelUrl,
      });
      return c.json(TopUpCheckoutOutput.parse(checkout), 201);
    } catch (error) {
      if (error instanceof PaymentsError) {
        // Provider text never contains the secret key, but keep only the code.
        throw new ApiError(
          error.code === 'invalid_payload' ? 'bad_request' : 'internal',
          'The payment provider could not create the checkout',
          { reason: error.code },
        );
      }
      throw error;
    }
  })

  .post('/webhooks/test', (c) => {
    const body = errorBody(
      'bad_request',
      'Webhooks are post-MVP and not available yet',
      c.var.requestId,
    );
    return c.json(ApiErrorBody.parse(body), 501);
  });
