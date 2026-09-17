import { verifySiweLogin } from '@pocketkey/chains-evm';
import { verifySiwsLogin } from '@pocketkey/chains-solana';
import { apps, type AppRow } from '@pocketkey/db';
import {
  AppConfig,
  AuthResponse,
  AuthTokens,
  DEVICE_ID_HEADER,
  DeviceId,
  type LoginMethod,
  LogoutOutput,
  PublicAppId,
  RefreshInput,
  WalletNonceInput,
  WalletNonceOutput,
  WalletVerifyInput,
} from '@pocketkey/types';
import { eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import { createEndUserAuth, type EndUserAuth } from '../auth/better-auth.js';
import { consumeChallenge, createChallenge, findLiveChallenge } from '../auth/challenges.js';
import {
  AUTH_COOKIES_HEADER,
  bridgeResponseCookies,
  cookieHeadersFrom,
  withBridgedCookies,
} from '../auth/cookie-bridge.js';
import { issueTokens, revokeFamily, rotateRefreshToken } from '../auth/tokens.js';
import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';
import { loadAppByPublicId } from '../lib/apps.js';
import { normalizeAuthError } from '../lib/auth-error.js';
import { getRpcFactory } from '../lib/rpc.js';
import { randomAlphanumeric, randomBytes, sha256Hex, toBase64Url } from '../lib/crypto.js';
import { validate } from '../lib/validate.js';
import { requireApp } from '../middleware/app.js';
import { requireUser } from '../middleware/user.js';
import { createWalletsOnLogin } from '../services/wallets.js';
import {
  loadEndUser,
  markActive,
  resolveFromAuthUser,
  resolveFromWallet,
  type ResolvedEndUser,
} from '../services/end-users.js';

const NONCE_TTL_SECONDS = 5 * 60;
const OAUTH_STATE_TTL_SECONDS = 10 * 60;
const EXCHANGE_CODE_TTL_SECONDS = 2 * 60;
const OAUTH_PROVIDERS = ['google', 'apple'] as const;
type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

type Ctx = Context<AppEnv>;

/* Helpers */

function loginMethodsOf(app: AppRow): Set<LoginMethod> {
  return new Set(AppConfig.parse(app.config).loginMethods);
}

function requireMethod(app: AppRow, method: LoginMethod): void {
  if (!loginMethodsOf(app).has(method)) {
    throw new ApiError('forbidden', `Login method "${method}" is disabled for this app`);
  }
}

async function deviceBinding(c: Ctx, required: boolean): Promise<string | undefined> {
  const raw = c.req.header(DEVICE_ID_HEADER);
  if (!raw) {
    if (required) throw new ApiError('bad_request', `Missing ${DEVICE_ID_HEADER} header`);
    return undefined;
  }
  const parsed = DeviceId.safeParse(raw);
  if (!parsed.success) throw new ApiError('bad_request', `Malformed ${DEVICE_ID_HEADER} header`);
  return (await sha256Hex(parsed.data)).slice(0, 32);
}

function authFor(c: Ctx, app: AppRow, binding?: string): EndUserAuth {
  return createEndUserAuth({
    db: c.var.db,
    app,
    config: c.var.config,
    mailer: c.var.mailer,
    deviceBinding: binding,
  });
}

async function completeLogin(
  c: Ctx,
  app: AppRow,
  resolved: ResolvedEndUser,
): Promise<AuthResponse> {
  await markActive(c.var.db, app, resolved.endUserId);
  // T2.3: embedded wallets exist before the SDK receives the user.
  await createWalletsOnLogin(
    { db: c.var.db, keyProvider: c.var.keyProvider, rpc: getRpcFactory(c.var.config), app },
    resolved.endUserId,
  );
  const tokens = await issueTokens({
    db: c.var.db,
    config: c.var.config,
    app,
    endUserId: resolved.endUserId,
    userAgent: c.req.header('User-Agent'),
  });
  const user = await loadEndUser(c.var.db, app, resolved.endUserId);
  return AuthResponse.parse({ ...tokens, user, isNewUser: resolved.isNewUser });
}

function oauthResultPage(embedOrigin: string, payload: { code?: string; error?: string }): string {
  // Values are JSON encoded, never concatenated into markup.
  const message = JSON.stringify({ type: 'pocketkey:oauth', ...payload });
  const target = JSON.stringify(embedOrigin);
  return `<!doctype html><meta charset="utf-8"><title>Pocketkey</title><script>(function(){var m=${message};if(window.opener){window.opener.postMessage(m,${target});}window.close();})();</script><p>You can close this window.</p>`;
}

/**
 * Only these Better Auth endpoints are reachable. Everything else (password
 * flows, user updates, account deletion, admin) stays closed by default.
 */
const PROXY_ALLOWLIST: {
  pattern: RegExp;
  method?: LoginMethod;
  deviceBound?: boolean;
  signsIn?: boolean;
}[] = [
  { pattern: /^\/email-otp\/send-verification-otp$/, method: 'email', deviceBound: true },
  { pattern: /^\/sign-in\/email-otp$/, method: 'email', deviceBound: true, signsIn: true },
  { pattern: /^\/passkey\/generate-register-options$/, method: 'passkey' },
  { pattern: /^\/passkey\/verify-registration$/, method: 'passkey' },
  { pattern: /^\/passkey\/list-user-passkeys$/, method: 'passkey' },
  { pattern: /^\/passkey\/delete-passkey$/, method: 'passkey' },
  { pattern: /^\/passkey\/generate-authenticate-options$/, method: 'passkey' },
  { pattern: /^\/passkey\/verify-authentication$/, method: 'passkey', signsIn: true },
  { pattern: /^\/get-session$/ },
  { pattern: /^\/sign-out$/ },
];

const SendOtpBody = z.object({ email: z.email(), type: z.literal('sign-in') });
const ExchangeInput = z.object({ code: z.string().min(16).max(128) });
const NONCE_LINE = /^Nonce: ([A-Za-z0-9]+)$/m;

/* Routes, mounted at /v1/auth */

export const authRoutes = new Hono<AppEnv>()
  /* T1.3: external wallets */
  .post('/wallet/nonce', requireApp, validate('json', WalletNonceInput), async (c) => {
    requireMethod(c.var.app, 'wallet');
    const { chainFamily } = c.req.valid('json');
    const nonce = randomAlphanumeric(32);
    const expiresAt = await createChallenge(c.var.db, {
      id: nonce,
      appId: c.var.app.id,
      purpose: chainFamily === 'evm' ? 'siwe' : 'siws',
      ttlSeconds: NONCE_TTL_SECONDS,
    });
    return c.json(WalletNonceOutput.parse({ nonce, expiresAt: expiresAt.toISOString() }));
  })

  .post('/wallet/verify', requireApp, validate('json', WalletVerifyInput), async (c) => {
    const app = c.var.app;
    requireMethod(app, 'wallet');
    const input = c.req.valid('json');

    const nonce = NONCE_LINE.exec(input.message)?.[1];
    if (!nonce) throw new ApiError('bad_request', 'Message has no nonce');
    // Consumed before verification: a nonce gets exactly one attempt (replay, section 8.1).
    const challenge = await consumeChallenge(c.var.db, {
      id: nonce,
      appId: app.id,
      purpose: input.chainFamily === 'evm' ? 'siwe' : 'siws',
    });
    if (!challenge) throw new ApiError('unauthorized', 'Nonce is unknown, expired or already used');

    const domains = [c.var.config.EMBED_ORIGIN, ...app.allowedOrigins].map(
      (origin) => new URL(origin).host,
    );

    let address: string | null = null;
    for (const domain of domains) {
      if (input.chainFamily === 'evm') {
        const result = await verifySiweLogin({
          message: input.message,
          signature: input.signature as `0x${string}`,
          expectedNonce: nonce,
          expectedDomain: domain,
        });
        address = result?.address ?? null;
      } else {
        address =
          verifySiwsLogin({
            message: input.message,
            signature: input.signature,
            publicKey: input.publicKey,
            expectedNonce: nonce,
            expectedDomain: domain,
          })?.address ?? null;
      }
      if (address) break;
    }
    if (!address) throw new ApiError('unauthorized', 'Signature verification failed');

    const resolved = await resolveFromWallet(c.var.db, app, input.chainFamily, address);
    return c.json(await completeLogin(c, app, resolved));
  })

  /* T1.4: session lifecycle */
  .post('/session/exchange', requireApp, async (c) => {
    const app = c.var.app;
    const auth = authFor(c, app);
    const session = await auth.api.getSession({ headers: withBridgedCookies(c.req.raw.headers) });
    if (!session) throw new ApiError('unauthorized', 'No authentication session to exchange');
    const resolved = await resolveFromAuthUser(c.var.db, app, session.user.id);
    return c.json(await completeLogin(c, app, resolved));
  })

  .post('/refresh', requireApp, validate('json', RefreshInput), async (c) => {
    const { tokens } = await rotateRefreshToken({
      db: c.var.db,
      config: c.var.config,
      app: c.var.app,
      refreshToken: c.req.valid('json').refreshToken,
      userAgent: c.req.header('User-Agent'),
    });
    return c.json(AuthTokens.parse(tokens));
  })

  .post('/logout', requireApp, requireUser, async (c) => {
    await revokeFamily(c.var.db, c.var.sessionFamilyId);
    const bridged = withBridgedCookies(c.req.raw.headers);
    if (bridged.has('Cookie')) {
      // Best effort: also end the Better Auth session kept for passkey enrollment.
      await authFor(c, c.var.app)
        .api.signOut({ headers: bridged })
        .catch(() => undefined);
    }
    c.header(AUTH_COOKIES_HEADER, '');
    return c.json(LogoutOutput.parse({ ok: true }));
  })

  /* OAuth popup flow. The popup is a first-party window on the API origin, so
     real cookies work there even when the iframe itself is cookie-less. */
  .get('/oauth/:publicAppId/:provider/start', async (c) => {
    const publicId = PublicAppId.safeParse(c.req.param('publicAppId'));
    const provider = z.enum(OAUTH_PROVIDERS).safeParse(c.req.param('provider'));
    if (!publicId.success || !provider.success)
      throw new ApiError('not_found', 'Unknown app or provider');

    const { app } = await loadAppByPublicId(c.var.db, publicId.data);
    if (!app) throw new ApiError('app_id_invalid', 'Unknown app id');
    requireMethod(app, provider.data);

    const config = c.var.config;
    const configured =
      provider.data === 'google'
        ? Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET)
        : Boolean(config.APPLE_CLIENT_ID && config.APPLE_CLIENT_SECRET);
    if (!configured)
      throw new ApiError(
        'bad_request',
        `${provider.data} sign-in is not configured on this server`,
      );

    const apiOrigin = new URL(config.API_BASE_URL).origin;
    const auth = authFor(c, app);
    const response = await auth.handler(
      new Request(`${apiOrigin}/v1/auth/sign-in/social`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: apiOrigin },
        body: JSON.stringify({
          provider: provider.data satisfies OAuthProvider,
          callbackURL: `${apiOrigin}/v1/auth/oauth/${app.publicId}/complete`,
          errorCallbackURL: `${apiOrigin}/v1/auth/oauth/${app.publicId}/complete`,
          disableRedirect: true,
        }),
      }),
    );
    if (!response.ok) return normalizeAuthError(c.var.requestId, response);

    const { url } = await response.clone().json<{ url: string }>();
    const state = new URL(url).searchParams.get('state');
    if (!state) throw new ApiError('internal', 'Provider URL has no state');
    await createChallenge(c.var.db, {
      id: await sha256Hex(state),
      appId: app.id,
      purpose: 'oauth_state',
      ttlSeconds: OAUTH_STATE_TTL_SECONDS,
    });

    const redirect = new Response(null, {
      status: 302,
      headers: { Location: url, 'Cache-Control': 'no-store' },
    });
    for (const cookie of response.headers.getSetCookie())
      redirect.headers.append('Set-Cookie', cookie);
    return redirect;
  })

  /* Provider callback. Google sends GET with a query, Apple sends a form POST. */
  .on(['GET', 'POST'], '/callback/:provider', async (c) => {
    let state = c.req.query('state');
    if (!state && c.req.method === 'POST') {
      const form = await c.req.raw
        .clone()
        .formData()
        .catch(() => null);
      const value = form?.get('state');
      state = typeof value === 'string' ? value : undefined;
    }
    if (!state) throw new ApiError('bad_request', 'Missing OAuth state');

    const challenge = await findLiveChallenge(c.var.db, {
      id: await sha256Hex(state),
      purpose: 'oauth_state',
    });
    if (!challenge) throw new ApiError('bad_request', 'Unknown or expired OAuth state');
    const app = await c.var.db.query.apps.findFirst({ where: eq(apps.id, challenge.appId) });
    if (!app) throw new ApiError('bad_request', 'Unknown or expired OAuth state');

    return normalizeAuthError(c.var.requestId, await authFor(c, app).handler(c.req.raw));
  })

  .get('/oauth/:publicAppId/complete', async (c) => {
    const embedOrigin = c.var.config.EMBED_ORIGIN;
    c.header('Cache-Control', 'no-store');
    const publicId = PublicAppId.safeParse(c.req.param('publicAppId'));
    const app = publicId.success
      ? (await loadAppByPublicId(c.var.db, publicId.data)).app
      : undefined;
    if (!app) return c.html(oauthResultPage(embedOrigin, { error: 'unknown_app' }), 404);

    const providerError = c.req.query('error');
    if (providerError)
      return c.html(oauthResultPage(embedOrigin, { error: providerError.slice(0, 64) }), 400);

    const session = await authFor(c, app).api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.html(oauthResultPage(embedOrigin, { error: 'no_session' }), 401);

    const code = toBase64Url(randomBytes(32));
    await createChallenge(c.var.db, {
      id: await sha256Hex(code),
      appId: app.id,
      purpose: 'exchange_code',
      subject: session.user.id,
      ttlSeconds: EXCHANGE_CODE_TTL_SECONDS,
    });
    return c.html(oauthResultPage(embedOrigin, { code }));
  })

  .post('/oauth/exchange', requireApp, validate('json', ExchangeInput), async (c) => {
    const app = c.var.app;
    const challenge = await consumeChallenge(c.var.db, {
      id: await sha256Hex(c.req.valid('json').code),
      appId: app.id,
      purpose: 'exchange_code',
    });
    if (!challenge?.subject)
      throw new ApiError('unauthorized', 'Exchange code is unknown, expired or already used');
    const resolved = await resolveFromAuthUser(c.var.db, app, challenge.subject);
    return c.json(await completeLogin(c, app, resolved));
  })

  /* T1.1 / T1.2: Better Auth for email OTP and passkeys, behind an allowlist */
  .on(['GET', 'POST'], '/*', requireApp, async (c) => {
    const app = c.var.app;
    const path = c.req.path.replace(/^\/v1\/auth/, '');
    const route = PROXY_ALLOWLIST.find((entry) => entry.pattern.test(path));
    if (!route) throw new ApiError('not_found', `No auth route for ${c.req.method} ${c.req.path}`);
    if (route.method) requireMethod(app, route.method);

    if (path === '/email-otp/send-verification-otp') {
      const body = SendOtpBody.safeParse(
        await c.req.raw
          .clone()
          .json()
          .catch(() => null),
      );
      if (!body.success)
        throw new ApiError(
          'validation_failed',
          'Expected { email, type: "sign-in" }',
          body.error.issues,
        );
    }

    const binding = await deviceBinding(c, route.deviceBound ?? false);
    const auth = authFor(c, app, binding);
    const forwarded = new Request(c.req.raw, { headers: withBridgedCookies(c.req.raw.headers) });
    const response = await auth.handler(forwarded);

    if (!response.ok)
      return normalizeAuthError(
        c.var.requestId,
        bridgeResponseCookies(c.req.raw.headers, response),
      );

    if (route.signsIn) {
      const session = await auth.api.getSession({
        headers: cookieHeadersFrom(response, c.req.raw.headers),
      });
      if (!session) throw new ApiError('internal', 'Sign-in succeeded without a session');
      const resolved = await resolveFromAuthUser(c.var.db, app, session.user.id);
      const body = await completeLogin(c, app, resolved);
      const bridged = bridgeResponseCookies(c.req.raw.headers, response);
      return c.json(body, 200 as ContentfulStatusCode, {
        [AUTH_COOKIES_HEADER]: bridged.headers.get(AUTH_COOKIES_HEADER) ?? '',
      });
    }

    return bridgeResponseCookies(c.req.raw.headers, response);
  });
