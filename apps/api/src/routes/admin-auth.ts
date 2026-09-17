import { AuthProviders } from '@pocketkey/types';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  createDeveloperAuth,
  DEVELOPER_AUTH_BASE_PATH,
  githubConfigured,
} from '../auth/developer-auth.js';
import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';
import { normalizeAuthError } from '../lib/auth-error.js';

/**
 * Better Auth for developers, behind an allowlist (T5.1). Mounted at
 * `/admin/auth`, which is also the Better Auth `basePath`, so the GitHub
 * redirect URI is `<API_BASE_URL>/admin/auth/callback/github`.
 *
 * Only the endpoints the dashboard actually calls are reachable. Everything
 * else (password flows, user updates, account deletion, admin plugins) answers
 * 404, exactly like the end user proxy of `routes/auth.ts`.
 */
const PROXY_ALLOWLIST: RegExp[] = [
  /^\/email-otp\/send-verification-otp$/,
  /^\/sign-in\/email-otp$/,
  /^\/sign-in\/social$/,
  /^\/callback\/[a-zA-Z0-9_-]+$/,
  /^\/get-session$/,
  /^\/sign-out$/,
];

const SendOtpBody = z.object({ email: z.email(), type: z.literal('sign-in') });
const SignInSocialBody = z.object({ provider: z.literal('github') }).loose();

export const adminAuthRoutes = new Hono<AppEnv>()
  /** Read before the login screen renders, so no button is offered that would answer 400. */
  .get('/providers', (c) =>
    c.json(AuthProviders.parse({ email: true, github: githubConfigured(c.var.config) })),
  )
  .on(['GET', 'POST'], '/*', async (c) => {
    const path = c.req.path.replace(new RegExp(`^${DEVELOPER_AUTH_BASE_PATH}`), '');
    if (!PROXY_ALLOWLIST.some((pattern) => pattern.test(path))) {
      throw new ApiError('not_found', `No auth route for ${c.req.method} ${c.req.path}`);
    }

    if (path === '/email-otp/send-verification-otp') {
      // Only the sign-in OTP: password reset and email change are not offered.
      const body = SendOtpBody.safeParse(
        await c.req.raw
          .clone()
          .json()
          .catch(() => null),
      );
      if (!body.success) {
        throw new ApiError(
          'validation_failed',
          'Expected { email, type: "sign-in" }',
          body.error.issues,
        );
      }
    }

    if (path === '/sign-in/social') {
      const body = SignInSocialBody.safeParse(
        await c.req.raw
          .clone()
          .json()
          .catch(() => null),
      );
      if (!body.success) {
        throw new ApiError(
          'validation_failed',
          'Expected { provider: "github" }',
          body.error.issues,
        );
      }
      if (!githubConfigured(c.var.config)) {
        throw new ApiError('bad_request', 'GitHub sign-in is not configured on this server');
      }
    }

    const auth = createDeveloperAuth({ db: c.var.db, config: c.var.config, mailer: c.var.mailer });
    // Real cookies: the dashboard proxies this under its own origin, so there is
    // no third party context and no cookie bridge. Set-Cookie passes through.
    return normalizeAuthError(c.var.requestId, await auth.handler(c.req.raw));
  });
