import {
  CreateSessionBody,
  SessionList,
  SessionSigner,
  SessionSignerId,
  SessionSignOutput,
  SessionSignRequest,
  SignerPermissionInput,
  SignerSetupInput,
  SignerSetupOutput,
} from '@pockey/types';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';
import { getRpcFactory } from '../lib/rpc.js';
import { sponsorRuntime } from '../lib/sponsor.js';
import { validate } from '../lib/validate.js';
import { requireApp } from '../middleware/app.js';
import { enforceRateLimit } from '../middleware/rate-limit.js';
import { requireUser } from '../middleware/user.js';
import {
  createSession,
  grantRevokePermission,
  listSessions,
  loadUserSession,
  revokeSession,
  setupSigner,
  signWithSession,
  toSessionSigner,
  type SessionDeps,
} from '../services/sessions.js';

const deps = (c: Context<AppEnv>): SessionDeps => ({
  db: c.var.db,
  keyProvider: c.var.keyProvider,
  rpc: getRpcFactory(c.var.config),
  app: c.var.app,
  sponsor: sponsorRuntime(c),
});

function sessionIdParam(c: Context<AppEnv>): string {
  const parsed = SessionSignerId.safeParse(c.req.param('id'));
  if (!parsed.success) throw new ApiError('not_found', 'Session not found');
  return parsed.data;
}

export const RevokeSessionOutput = z.object({ ok: z.literal(true) });

/** Section 7.2 session signer routes (T4.2). Every route is end-user scoped. */
export const sessionRoutes = new Hono<AppEnv>()
  .use(requireApp, requireUser)

  /** Adds the Pockey signer to the user's sub-organization (stamped in the iframe). */
  .post('/signer', validate('json', SignerSetupInput), async (c) => {
    const signerUserId = await setupSigner(
      deps(c),
      c.var.endUserId,
      c.req.valid('json').createSigner,
    );
    return c.json(SignerSetupOutput.parse({ signerUserId }));
  })

  /** Lets the signer revoke session policies, so revocation works from the API too. */
  .post('/signer/permission', validate('json', SignerPermissionInput), async (c) => {
    await grantRevokePermission(deps(c), c.var.endUserId, c.req.valid('json').request);
    return c.json(RevokeSessionOutput.parse({ ok: true }));
  })

  .post('/', validate('json', CreateSessionBody), async (c) => {
    const row = await createSession(deps(c), c.var.endUserId, c.req.valid('json'));
    return c.json(SessionSigner.parse(toSessionSigner(row)), 201);
  })

  .get('/', async (c) => {
    const rows = await listSessions(deps(c), c.var.endUserId);
    return c.json(SessionList.parse({ sessions: rows.map(toSessionSigner) }));
  })

  .delete('/:id', async (c) => {
    await revokeSession(deps(c), c.var.endUserId, sessionIdParam(c));
    return c.json(RevokeSessionOutput.parse({ ok: true }));
  })

  .post('/:id/sign', validate('json', SessionSignRequest), async (c) => {
    const request = c.req.valid('json');
    // Same cap as an interactive send (section 8.1): a session signer must not
    // be a way around the sponsored send limit.
    if (request.kind === 'transaction' && request.sponsored) {
      await enforceRateLimit(c, 'sponsoredSend', c.var.endUserId);
    }
    const d = deps(c);
    const session = await loadUserSession(d, c.var.endUserId, sessionIdParam(c));
    const out = await signWithSession(d, session, request, { via: 'user' });
    return c.json(SessionSignOutput.parse(out));
  });
