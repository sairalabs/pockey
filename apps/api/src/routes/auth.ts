import { secp256k1 } from '@noble/curves/secp256k1.js';
import type { AppRow } from '@pocketkey/db';
import { KeyProviderError, type ProviderSession } from '@pocketkey/key-provider';
import {
  AddPasskeyInput,
  AppConfig,
  AuthResponse,
  AuthTokens,
  EmailOtpLoginInput,
  EmailOtpStartInput,
  EmailOtpStartOutput,
  EmailOtpVerifyInput,
  EmailOtpVerifyOutput,
  type LoginMethod,
  LogoutOutput,
  OAuthExchangeInput,
  PublicAppId,
  RefreshInput,
  SessionPublicKey,
  StampedLoginInput,
  WalletLoginInput,
} from '@pocketkey/types';
import { base58 } from '@scure/base';
import { Hono, type Context } from 'hono';
import { publicKeyToAddress } from 'viem/utils';
import { z } from 'zod';
import {
  consumeChallenge,
  createChallenge,
  findLiveChallenge,
  setChallengePayload,
} from '../auth/challenges.js';
import { issueTokens, revokeFamily, rotateRefreshToken } from '../auth/tokens.js';
import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';
import { loadAppByPublicId } from '../lib/apps.js';
import { randomBytes, sha256Hex, toBase64Url } from '../lib/crypto.js';
import {
  callbackUrl,
  exchangeCode,
  nonceFor,
  oidcCredentials,
  startAuthorization,
  type OidcProvider,
} from '../lib/oidc.js';
import { getRpcFactory } from '../lib/rpc.js';
import { validate } from '../lib/validate.js';
import { requireApp } from '../middleware/app.js';
import { requireUser } from '../middleware/user.js';
import {
  addIdentity,
  loadEndUser,
  markActive,
  resolveFromIdentity,
  walletIdentifier,
} from '../services/end-users.js';
import {
  attachSubOrganization,
  endUserBySubOrg,
  keySessionOf,
  loadEndUserRow,
  relayFailure,
} from '../services/key-session.js';
import { providerFailure } from '../services/provider-failure.js';
import { createWalletsOnLogin } from '../services/wallets.js';

/**
 * End user authentication (section 4, non-custodial since 2026-09-19).
 *
 * The key provider runs every ceremony that grants access to keys: it sends and
 * checks email codes, verifies OIDC tokens, passkey and wallet signatures, and
 * registers the iframe session key. This API maps the verified identity to a
 * Pocketkey end user and issues Pocketkey tokens; it never holds a credential that
 * could sign for the user.
 */

const OTP_TTL_SECONDS = 10 * 60;
const OAUTH_STATE_TTL_SECONDS = 10 * 60;
const EXCHANGE_CODE_TTL_SECONDS = 2 * 60;
const OAUTH_PROVIDERS = ['google', 'apple'] as const;
/** Matches the refresh token: the iframe session key lives as long as the Pocketkey session. */
const SESSION_KEY_SECONDS = 30 * 24 * 3600;

type Ctx = Context<AppEnv>;

function requireMethod(app: AppRow, method: LoginMethod): void {
  if (!AppConfig.parse(app.config).loginMethods.includes(method)) {
    throw new ApiError('forbidden', `Login method "${method}" is disabled for this app`);
  }
}

function appDisplayName(app: AppRow): string {
  return AppConfig.parse(app.config).appearance.name ?? app.name;
}

async function completeLogin(
  c: Ctx,
  app: AppRow,
  endUserId: string,
  isNewUser: boolean,
): Promise<AuthResponse> {
  await markActive(c.var.db, app, endUserId);
  // T2.3: embedded wallets exist before the SDK receives the user.
  await createWalletsOnLogin(
    { db: c.var.db, keyProvider: c.var.keyProvider, rpc: getRpcFactory(c.var.config), app },
    endUserId,
  );
  const tokens = await issueTokens({
    db: c.var.db,
    config: c.var.config,
    app,
    endUserId,
    userAgent: c.req.header('User-Agent'),
  });
  const user = await loadEndUser(c.var.db, app, endUserId);
  const keySession = keySessionOf(await loadEndUserRow(c.var.db, app, endUserId));
  if (!keySession) throw new ApiError('internal', 'Login without a key provider sub-organization');
  return AuthResponse.parse({ ...tokens, user, isNewUser, keySession });
}

/** A session registered at the provider must belong to an end user of this app. */
async function endUserOfSession(c: Ctx, app: AppRow, session: ProviderSession) {
  const user = await endUserBySubOrg(c.var.db, app, session.subOrgId);
  if (!user) {
    // A credential of another app, or a sub-organization we never recorded.
    throw new ApiError('unauthorized', 'No account for this credential in this app');
  }
  return user;
}

function oauthResultPage(embedOrigin: string, payload: { code?: string; error?: string }): string {
  // Values are JSON encoded, never concatenated into markup.
  const message = JSON.stringify({ type: 'pocketkey:oauth', ...payload });
  const target = JSON.stringify(embedOrigin);
  return `<!doctype html><meta charset="utf-8"><title>Pocketkey</title><script>(function(){var m=${message};if(window.opener){window.opener.postMessage(m,${target});}window.close();})();</script><p>You can close this window.</p>`;
}

const EmailOtpPayload = z.object({ verificationToken: z.string().min(1) });
const OAuthStatePayload = z.object({
  provider: z.enum(OAUTH_PROVIDERS),
  publicKey: SessionPublicKey,
  codeVerifier: z.string().nullable(),
});
const ExchangePayload = z.object({
  provider: z.enum(OAUTH_PROVIDERS),
  publicKey: SessionPublicKey,
  idToken: z.string().min(1),
  subject: z.string().min(1),
  email: z.string().nullable(),
});

/** Compressed public key of a wallet stamp to its address. */
function walletAddress(chainFamily: 'evm' | 'solana', publicKey: string): string {
  if (chainFamily === 'solana') {
    return base58.encode(Uint8Array.from(publicKey.match(/../g) ?? [], (h) => parseInt(h, 16)));
  }
  const uncompressed = secp256k1.Point.fromHex(publicKey).toHex(false);
  return publicKeyToAddress(`0x${uncompressed}`);
}

/* Routes, mounted at /v1/auth */

export const authRoutes = new Hono<AppEnv>()
  /* Email OTP, in three steps. The provider sends the code; the iframe encrypts it
     to the provider enclave with its session key, so the code never reaches us. */

  .post('/email/start', requireApp, validate('json', EmailOtpStartInput), async (c) => {
    const app = c.var.app;
    requireMethod(app, 'email');
    const email = c.req.valid('json').email.trim().toLowerCase();
    const logo = AppConfig.parse(app.config).appearance.logo;
    const { otpId, encryptionTargetBundle } = await c.var.keyProvider
      .startEmailOtp({
        email,
        appName: appDisplayName(app),
        ...(logo?.startsWith('https://') ? { logoUrl: logo } : {}),
      })
      .catch(providerFailure);
    await createChallenge(c.var.db, {
      id: otpId,
      appId: app.id,
      purpose: 'email_otp',
      subject: email,
      ttlSeconds: OTP_TTL_SECONDS,
    });
    return c.json(EmailOtpStartOutput.parse({ otpId, targetBundle: encryptionTargetBundle }));
  })

  .post('/email/verify', requireApp, validate('json', EmailOtpVerifyInput), async (c) => {
    const app = c.var.app;
    requireMethod(app, 'email');
    const input = c.req.valid('json');
    const flow = await findLiveChallenge(c.var.db, {
      id: input.otpId,
      appId: app.id,
      purpose: 'email_otp',
    });
    if (!flow?.subject) throw new ApiError('bad_request', 'This code expired, request a new one');

    let verificationToken: string;
    try {
      ({ verificationToken } = await c.var.keyProvider.verifyEmailOtp(input));
    } catch (error) {
      if (error instanceof KeyProviderError && error.code === 'invalid_input') {
        throw new ApiError('bad_request', 'That code is not valid', { reason: 'invalid_code' });
      }
      return providerFailure(error);
    }
    await setChallengePayload(c.var.db, {
      id: input.otpId,
      appId: app.id,
      purpose: 'email_otp',
      payload: { verificationToken },
    });

    const identity = await c.var.db.query.endUserIdentities.findFirst({
      where: (t, { and: all, eq: is }) =>
        all(is(t.appId, app.id), is(t.type, 'email'), is(t.identifier, flow.subject ?? '')),
    });
    const owner = identity ? await loadEndUserRow(c.var.db, app, identity.endUserId) : null;
    const mode = owner?.keyProviderSubOrgId ? 'login' : 'signup';
    return c.json(EmailOtpVerifyOutput.parse({ verificationToken, mode }));
  })

  .post('/email/login', requireApp, validate('json', EmailOtpLoginInput), async (c) => {
    const app = c.var.app;
    requireMethod(app, 'email');
    const input = c.req.valid('json');
    // Only a verified flow is consumed: calling login too early must not burn the code.
    const pending = await findLiveChallenge(c.var.db, {
      id: input.otpId,
      appId: app.id,
      purpose: 'email_otp',
    });
    if (!EmailOtpPayload.safeParse(pending?.payload).success) {
      throw new ApiError('bad_request', 'Verify the code first, or request a new one');
    }
    const flow = await consumeChallenge(c.var.db, {
      id: input.otpId,
      appId: app.id,
      purpose: 'email_otp',
    });
    const payload = EmailOtpPayload.safeParse(flow?.payload);
    if (!flow?.subject || !payload.success) {
      throw new ApiError('bad_request', 'This code expired, request a new one');
    }
    const email = flow.subject;
    const { verificationToken } = payload.data;

    const resolved = await resolveFromIdentity(c.var.db, app, { type: 'email', identifier: email });
    const user = await loadEndUserRow(c.var.db, app, resolved.endUserId);

    if (input.mode === 'signup') {
      if (user.keyProviderSubOrgId) {
        throw new ApiError('conflict', 'This account exists, sign in instead', {
          reason: 'account_exists',
        });
      }
      const created = await c.var.keyProvider
        .createSubOrganization({
          endUserId: user.id,
          root: {
            kind: 'email',
            email,
            sessionKey: input.sessionKey,
            verificationToken,
            clientSignature: input.clientSignature,
          },
        })
        .catch(relayFailure);
      await attachSubOrganization(c.var.db, user.id, created);
      return c.json(await completeLogin(c, app, user.id, true));
    }

    if (!user.keyProviderSubOrgId) {
      throw new ApiError('bad_request', 'No account yet, sign up instead', {
        reason: 'account_missing',
      });
    }
    await c.var.keyProvider
      .otpLogin({
        subOrgId: user.keyProviderSubOrgId,
        verificationToken,
        publicKey: input.publicKey,
        clientSignature: input.clientSignature,
        expirationSeconds: SESSION_KEY_SECONDS,
      })
      .catch(relayFailure);
    return c.json(await completeLogin(c, app, user.id, resolved.isNewUser));
  })

  /* External wallets. The wallet signs the provider login request itself, which
     carries the iframe session key: one wallet prompt, and only that key logs in. */

  .post(
    '/wallet/lookup',
    requireApp,
    validate(
      'json',
      z.object({ chainFamily: z.enum(['evm', 'solana']), address: z.string().min(32).max(64) }),
    ),
    async (c) => {
      const app = c.var.app;
      requireMethod(app, 'wallet');
      const { chainFamily, address } = c.req.valid('json');
      const identity = await c.var.db.query.endUserIdentities.findFirst({
        where: (t, { and: all, eq: is }) =>
          all(
            is(t.appId, app.id),
            is(t.type, 'wallet'),
            is(t.identifier, walletIdentifier(chainFamily, address)),
          ),
      });
      const owner = identity ? await loadEndUserRow(c.var.db, app, identity.endUserId) : null;
      return c.json({ organizationId: owner?.keyProviderSubOrgId ?? null });
    },
  )

  .post('/wallet/login', requireApp, validate('json', WalletLoginInput), async (c) => {
    const app = c.var.app;
    requireMethod(app, 'wallet');
    const { chainFamily, request } = c.req.valid('json');
    const keyProvider = c.var.keyProvider;

    const signer = keyProvider.inspectStamp(request);
    const expectedScheme = chainFamily === 'evm' ? 'secp256k1' : 'ed25519';
    if (signer?.scheme !== expectedScheme || !('publicKey' in signer)) {
      throw new ApiError('unauthorized', 'The wallet signature does not verify');
    }
    const login = keyProvider.readLoginRequest(request);
    if (!login) throw new ApiError('bad_request', 'Not a login request');
    const address = walletAddress(chainFamily, signer.publicKey);
    const resolved = await resolveFromIdentity(c.var.db, app, {
      type: 'wallet',
      identifier: walletIdentifier(chainFamily, address),
    });
    const user = await loadEndUserRow(c.var.db, app, resolved.endUserId);

    if (!user.keyProviderSubOrgId) {
      // Sign-up: the signed request must target the parent organization, and its
      // session key becomes a second root credential next to the wallet key.
      if (login.organizationId !== keyProvider.info().organizationId) {
        throw new ApiError('bad_request', 'Unexpected login target');
      }
      const created = await keyProvider
        .createSubOrganization({
          endUserId: user.id,
          root: {
            kind: 'wallet',
            chainFamily,
            publicKey: signer.publicKey,
            sessionKey: {
              apiKeyName: `session-${Date.now()}`,
              publicKey: login.publicKey,
              expirationSeconds: String(login.expirationSeconds),
            },
          },
        })
        .catch(relayFailure);
      await attachSubOrganization(c.var.db, user.id, created);
      return c.json(await completeLogin(c, app, user.id, true));
    }

    const session = await keyProvider
      .relay(request, { kind: 'login', subOrgId: user.keyProviderSubOrgId })
      .catch(relayFailure);
    const owner = await endUserOfSession(c, app, session);
    if (owner.id !== user.id) throw new ApiError('unauthorized', 'Credential mismatch');
    return c.json(await completeLogin(c, app, user.id, false));
  })

  /* Passkeys. A login addressed to the parent organization: the provider finds the
     sub-organization of the credential, we map it to an end user of this app. */

  .post('/passkey/login', requireApp, validate('json', StampedLoginInput), async (c) => {
    const app = c.var.app;
    requireMethod(app, 'passkey');
    const { request } = c.req.valid('json');
    const session = await c.var.keyProvider.relay(request, { kind: 'login' }).catch(relayFailure);
    const user = await endUserOfSession(c, app, session);
    return c.json(await completeLogin(c, app, user.id, false));
  })

  /** Enrolls a passkey on the signed-in user: an authenticator of their sub-organization. */
  .post(
    '/passkey/register',
    requireApp,
    requireUser,
    validate('json', AddPasskeyInput),
    async (c) => {
      const app = c.var.app;
      requireMethod(app, 'passkey');
      const user = await loadEndUserRow(c.var.db, app, c.var.endUserId);
      const keySession = keySessionOf(user);
      if (!keySession) throw new ApiError('bad_request', 'This user has no wallet yet');
      const { credentialId } = await c.var.keyProvider
        .relay(c.req.valid('json').request, {
          kind: 'addPasskey',
          subOrgId: keySession.organizationId,
          userId: keySession.userId,
        })
        .catch(relayFailure);
      await addIdentity(c.var.db, app, user.id, { type: 'passkey', identifier: credentialId });
      return c.json(await loadEndUser(c.var.db, app, user.id));
    },
  )

  /* Session lifecycle */

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
    // The iframe drops its session key; the provider key expires on its own.
    await revokeFamily(c.var.db, c.var.sessionFamilyId);
    return c.json(LogoutOutput.parse({ ok: true }));
  })

  /* OAuth popup. First-party window on the API origin; the nonce commits to the
     iframe session key given in the start URL. */

  .get('/oauth/:publicAppId/:provider/start', async (c) => {
    const publicId = PublicAppId.safeParse(c.req.param('publicAppId'));
    const provider = z.enum(OAUTH_PROVIDERS).safeParse(c.req.param('provider'));
    const publicKey = SessionPublicKey.safeParse(c.req.query('publicKey'));
    if (!publicId.success || !provider.success) {
      throw new ApiError('not_found', 'Unknown app or provider');
    }
    if (!publicKey.success) throw new ApiError('bad_request', 'Missing session public key');

    const { app } = await loadAppByPublicId(c.var.db, publicId.data);
    if (!app) throw new ApiError('app_id_invalid', 'Unknown app id');
    requireMethod(app, provider.data);
    const credentials = oidcCredentials(c.var.config, provider.data);
    if (!credentials) {
      throw new ApiError(
        'bad_request',
        `${provider.data} sign-in is not configured on this server`,
      );
    }

    const start = await startAuthorization({
      provider: provider.data,
      clientId: credentials.clientId,
      redirectUri: callbackUrl(c.var.config, provider.data),
      nonce: await nonceFor(publicKey.data),
    });
    await createChallenge(c.var.db, {
      id: await sha256Hex(start.state),
      appId: app.id,
      purpose: 'oauth_state',
      payload: {
        provider: provider.data,
        publicKey: publicKey.data,
        codeVerifier: start.codeVerifier,
      },
      ttlSeconds: OAUTH_STATE_TTL_SECONDS,
    });
    return new Response(null, {
      status: 302,
      headers: { Location: start.url, 'Cache-Control': 'no-store' },
    });
  })

  /* Provider callback. Google sends GET with a query, Apple sends a form POST. */
  .on(['GET', 'POST'], '/callback/:provider', async (c) => {
    const embedOrigin = c.var.config.EMBED_ORIGIN;
    c.header('Cache-Control', 'no-store');
    const provider = z.enum(OAUTH_PROVIDERS).safeParse(c.req.param('provider'));
    let params: URLSearchParams = new URL(c.req.url).searchParams;
    if (c.req.method === 'POST') {
      const form = await c.req.raw.formData().catch(() => null);
      params = new URLSearchParams();
      form?.forEach((value, key) => {
        if (typeof value === 'string') params.set(key, value);
      });
    }
    const state = params.get('state');
    if (!provider.success || !state) {
      return c.html(oauthResultPage(embedOrigin, { error: 'invalid_request' }), 400);
    }

    const stateId = await sha256Hex(state);
    const pending = await findLiveChallenge(c.var.db, { id: stateId, purpose: 'oauth_state' });
    const statePayload = OAuthStatePayload.safeParse(pending?.payload);
    if (!pending || !statePayload.success || statePayload.data.provider !== provider.data) {
      return c.html(oauthResultPage(embedOrigin, { error: 'expired' }), 400);
    }
    await consumeChallenge(c.var.db, { id: stateId, appId: pending.appId, purpose: 'oauth_state' });

    const providerError = params.get('error');
    if (providerError) {
      return c.html(oauthResultPage(embedOrigin, { error: providerError.slice(0, 64) }), 400);
    }
    const code = params.get('code');
    const credentials = oidcCredentials(c.var.config, provider.data);
    if (!code || !credentials) {
      return c.html(oauthResultPage(embedOrigin, { error: 'invalid_request' }), 400);
    }

    let exchanged: Awaited<ReturnType<typeof exchangeCode>>;
    try {
      exchanged = await exchangeCode({
        provider: provider.data,
        ...credentials,
        redirectUri: callbackUrl(c.var.config, provider.data),
        code,
        codeVerifier: statePayload.data.codeVerifier,
        expectedNonce: await nonceFor(statePayload.data.publicKey),
        ...(oidcFetchForTests ? { fetch: oidcFetchForTests } : {}),
      });
    } catch {
      return c.html(oauthResultPage(embedOrigin, { error: 'provider_refused' }), 400);
    }

    const exchangeCodeValue = toBase64Url(randomBytes(32));
    await createChallenge(c.var.db, {
      id: await sha256Hex(exchangeCodeValue),
      appId: pending.appId,
      purpose: 'exchange_code',
      payload: {
        provider: provider.data,
        publicKey: statePayload.data.publicKey,
        idToken: exchanged.idToken,
        subject: exchanged.claims.sub,
        email: exchanged.claims.email ?? null,
      },
      ttlSeconds: EXCHANGE_CODE_TTL_SECONDS,
    });
    return c.html(oauthResultPage(embedOrigin, { code: exchangeCodeValue }));
  })

  .post('/oauth/exchange', requireApp, validate('json', OAuthExchangeInput), async (c) => {
    const app = c.var.app;
    const input = c.req.valid('json');
    const challenge = await consumeChallenge(c.var.db, {
      id: await sha256Hex(input.code),
      appId: app.id,
      purpose: 'exchange_code',
    });
    const payload = ExchangePayload.safeParse(challenge?.payload);
    if (!payload.success) {
      throw new ApiError('unauthorized', 'Exchange code is unknown, expired or already used');
    }
    const { provider, idToken, subject, publicKey } = payload.data;
    if (publicKey !== input.publicKey) {
      throw new ApiError('unauthorized', 'This sign-in was started with another session key');
    }
    requireMethod(app, provider);

    const resolved = await resolveFromIdentity(c.var.db, app, {
      type: provider,
      identifier: subject,
    });
    const user = await loadEndUserRow(c.var.db, app, resolved.endUserId);
    let subOrgId = user.keyProviderSubOrgId;
    if (!subOrgId) {
      const created = await c.var.keyProvider
        .createSubOrganization({
          endUserId: user.id,
          root: { kind: 'oidc', providerName: provider satisfies OidcProvider, oidcToken: idToken },
        })
        .catch(relayFailure);
      await attachSubOrganization(c.var.db, user.id, created);
      subOrgId = created.subOrgId;
    }
    await c.var.keyProvider
      .oauthLogin({
        subOrgId,
        oidcToken: idToken,
        publicKey,
        expirationSeconds: SESSION_KEY_SECONDS,
      })
      .catch(relayFailure);
    return c.json(await completeLogin(c, app, user.id, resolved.isNewUser));
  });

/* Test hook: the OIDC token endpoint, replaced in tests (no network in workerd tests). */
let oidcFetchForTests: typeof fetch | null = null;
export function setOidcFetchForTests(fetchFn: typeof fetch | null): void {
  oidcFetchForTests = fetchFn;
}
