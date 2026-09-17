import { endUsers, sessionSigners, wallets } from '@pocketkey/db';
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
} from '@pocketkey/types';
import { PaymentsError } from '@pocketkey/payments';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context.js';
import { ApiError, errorBody } from '../errors.js';
import { toBase64Url } from '../lib/crypto.js';
import { getRpcFactory } from '../lib/rpc.js';
import { getPayments, sponsorRuntime } from '../lib/sponsor.js';
import { validate } from '../lib/validate.js';
import { requireApiKey } from '../middleware/api-key.js';
import { requireApp } from '../middleware/app.js';
import { loadEndUser } from '../services/end-users.js';
import { signWithSession, type SessionDeps } from '../services/sessions.js';
import { getBalance } from '../services/sponsoring.js';

const deps = (c: Context<AppEnv>): SessionDeps => ({
  db: c.var.db,
  keyProvider: c.var.keyProvider,
  rpc: getRpcFactory(c.var.config),
  app: c.var.app,
  sponsor: sponsorRuntime(c),
});

/* Opaque cursor: base64url JSON of the last (createdAt ms, id) returned. */

const CursorPayload = z.object({ t: z.number().int().nonnegative(), i: EndUserId });
type CursorPayload = z.infer<typeof CursorPayload>;

export function encodeCursor(payload: CursorPayload): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
}

function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const base64 = cursor.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed = CursorPayload.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const ServerUsersQuery = z.object({
  cursor: z
    .string()
    .max(200)
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value === '') return undefined;
      const decoded = decodeCursor(value);
      if (!decoded) {
        ctx.addIssue({ code: 'custom', message: 'Invalid cursor' });
        return z.NEVER;
      }
      return decoded;
    }),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const SignParams = z.object({ id: EndUserId, wid: WalletId });

// `created_at` comes from `unixepoch('subsec') * 1000`, a REAL: round it so the
// cursor compares whole milliseconds exactly.
const createdAtMs = sql<number>`cast(round(${endUsers.createdAt}) as integer)`;

/** Section 7.2 server routes (secret API key). */
export const serverRoutes = new Hono<AppEnv>()
  .use(requireApp, requireApiKey)

  .get('/users', validate('query', ServerUsersQuery), async (c) => {
    const { cursor, limit } = c.req.valid('query');
    const scope = eq(endUsers.appId, c.var.app.id);
    const where = cursor
      ? and(
          scope,
          or(lt(createdAtMs, cursor.t), and(eq(createdAtMs, cursor.t), lt(endUsers.id, cursor.i))),
        )
      : scope;

    const rows = await c.var.db
      .select({ id: endUsers.id, createdAt: createdAtMs })
      .from(endUsers)
      .where(where)
      .orderBy(desc(createdAtMs), desc(endUsers.id))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const nextCursor =
      rows.length > limit && last
        ? encodeCursor({ t: last.createdAt, i: last.id as EndUserId })
        : null;

    const users = [];
    for (const row of page) users.push(await loadEndUser(c.var.db, c.var.app, row.id));
    return c.json(ServerUserList.parse({ users, nextCursor }));
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

  /* Gas sponsoring balance (T4.6) */

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
